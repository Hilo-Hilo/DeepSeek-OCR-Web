"""
inference_runner.py
-------------------
DeepSeek OCR 后端核心执行器
支持：
- 自动识别 PDF / 图片
- 实时进度回调
- 临时覆盖 config.py
- 任务状态 JSON 持久化
"""

import json
import subprocess
import threading
from pathlib import Path
from typing import Callable, Optional, Dict, Any

from config_loader import MODEL_PATH, LOGS_DIR
from file_manager import detect_file_type, create_result_dir, list_result_files

# 核心脚本路径
PROJECT_ROOT = Path(__file__).resolve().parent
# Use Hugging Face backend scripts (compatible with PyTorch nightly / Blackwell GPUs)
PDF_SCRIPT = PROJECT_ROOT / "run_dpsk_ocr_pdf_hf.py"
IMAGE_SCRIPT = PROJECT_ROOT / "run_dpsk_ocr_image_hf.py"
# Fallback to vLLM scripts if HF scripts don't exist
if not PDF_SCRIPT.exists():
    PDF_SCRIPT = PROJECT_ROOT / "run_dpsk_ocr_pdf.py"
if not IMAGE_SCRIPT.exists():
    IMAGE_SCRIPT = PROJECT_ROOT / "run_dpsk_ocr_image.py"
CONFIG_PATH = PROJECT_ROOT / "config.py"


# ====== 任务状态持久化 ======
def write_task_state(task_id: str, state: Dict[str, Any]):
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    state_path = LOGS_DIR / f"task_{task_id}.json"
    with open(state_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    return state_path


def read_task_state(task_id: str) -> Optional[Dict[str, Any]]:
    state_path = LOGS_DIR / f"task_{task_id}.json"
    if not state_path.exists():
        return None
    try:
        with open(state_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


# ====== 临时写入 config.py ======
def override_config(model_path: str, input_path: str, output_path: str, prompt: str):
    """为每个任务动态生成 config.py"""
    config_lines = [
        "# Auto-generated config for DeepSeek OCR",
        "BASE_SIZE = 1024",
        "IMAGE_SIZE = 640",
        "CROP_MODE = True",
        "MIN_CROPS = 2",
        "MAX_CROPS = 6",
        "MAX_CONCURRENCY = 10",
        "NUM_WORKERS = 32",
        "PRINT_NUM_VIS_TOKENS = False",
        "SKIP_REPEAT = True",
        "",
        f"MODEL_PATH = r'{model_path}'",
        f"INPUT_PATH = r'{input_path}'",
        f"OUTPUT_PATH = r'{output_path}'",
        f'PROMPT = """{prompt}"""',
        "",
        "from transformers import AutoTokenizer",
        "TOKENIZER = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)",
    ]
    CONFIG_PATH.write_text("\n".join(config_lines), encoding="utf-8")
    print(f"✅ 临时覆盖 config.py 成功：{CONFIG_PATH}")


# ====== 核心任务执行 ======
def run_ocr_task(
    input_path: str,
    task_id: str,
    on_progress: Optional[Callable[[int], None]] = None,
    prompt: str = "<image>\nFree OCR."
) -> Dict[str, Any]:
    """执行 OCR 任务"""
    try:
        result_dir = create_result_dir(prefix=f"ocr_task_{task_id}")
        write_task_state(task_id, {"status": "running", "result_dir": str(result_dir)})

        file_type = detect_file_type(input_path)
        script_path = PDF_SCRIPT if file_type == "pdf" else IMAGE_SCRIPT

        override_config(MODEL_PATH, input_path, str(result_dir), prompt)

        print(f"🚀 启动 DeepSeek OCR 任务 ({file_type.upper()})")
        print(f"📄 使用脚本: {script_path}")
        print(f"📁 输出路径: {result_dir}")

        command = ["python", str(script_path)]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )

        progress = 0

        def _read_output():
            nonlocal progress
            for line in process.stdout:
                line = line.strip()

                # 根据日志关键字推算进度
                if "loading" in line.lower():
                    progress = 10
                elif "pre-processed" in line.lower():
                    progress = 30
                elif "generate" in line.lower():
                    progress = 60
                elif "save results" in line.lower():
                    progress = 90
                elif "result_with_boxes" in line.lower() or "complete" in line.lower():
                    progress = 100

                # 每次进度更新都写入任务状态文件
                write_task_state(task_id, {
                    "status": "running",
                    "result_dir": str(result_dir),
                    "progress": progress
                })

                if on_progress:
                    on_progress(progress)

                print(line)

        thread = threading.Thread(target=_read_output)
        thread.start()
        process.wait()
        thread.join()

        if process.returncode != 0:
            write_task_state(task_id, {"status": "error", "message": "DeepSeek OCR 执行失败"})
            raise RuntimeError("DeepSeek OCR 执行失败")

        files = list_result_files(result_dir)
        write_task_state(task_id, {"status": "finished", "result_dir": str(result_dir), "files": files})

        print(f"✅ 任务完成：{task_id}")
        return {"status": "finished", "task_id": task_id, "result_dir": str(result_dir), "files": files}

    except Exception as e:
        write_task_state(task_id, {"status": "error", "message": str(e)})
        print(f"❌ 任务异常 {task_id}: {e}")
        return {"status": "error", "message": str(e)}
