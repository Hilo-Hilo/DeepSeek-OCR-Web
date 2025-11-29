"""
inference_runner.py
-------------------
DeepSeek OCR Backend Core Executor
Supports:
- Automatic PDF / Image detection
- Real-time progress callbacks
- Temporary config.py override
- Task state JSON persistence
- Runtime tracking
- Console output streaming
"""

import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Optional, Dict, Any
from datetime import datetime

from config_loader import MODEL_PATH, LOGS_DIR
from file_manager import detect_file_type, create_result_dir, list_result_files

# Core script paths
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


# ====== Task State Persistence ======
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


# ====== Temporary config.py Override ======
def override_config(model_path: str, input_path: str, output_path: str, prompt: str):
    """Dynamically generate config.py for each task"""
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
    print(f"✅ Temporary config.py override successful: {CONFIG_PATH}")


# ====== Core Task Execution ======
def run_ocr_task(
    input_path: str,
    task_id: str,
    on_progress: Optional[Callable[[int], None]] = None,
    prompt: str = "<image>\nFree OCR.",
    filename: str = "",
    original_filename: str = "",
    on_console_log: Optional[Callable[[str], None]] = None
) -> Dict[str, Any]:
    """Execute OCR task"""
    start_time = time.time()
    timestamp = datetime.now().isoformat()
    
    try:
        result_dir = create_result_dir(prefix=f"ocr_task_{task_id}")
        write_task_state(task_id, {
            "status": "running", 
            "result_dir": str(result_dir),
            "filename": filename,
            "original_filename": original_filename,
            "timestamp": timestamp,
            "start_time": start_time
        })

        file_type = detect_file_type(input_path)
        script_path = PDF_SCRIPT if file_type == "pdf" else IMAGE_SCRIPT

        override_config(MODEL_PATH, input_path, str(result_dir), prompt)

        print(f"🚀 Starting DeepSeek OCR task ({file_type.upper()})")
        print(f"📄 Using script: {script_path}")
        print(f"📁 Output path: {result_dir}")

        command = ["python", str(script_path)]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )

        progress = 0
        console_buffer = []

        def _read_output():
            nonlocal progress
            for line in process.stdout:
                line = line.strip()
                
                # Store console output
                console_buffer.append(line)
                
                # Send to console WebSocket if callback provided
                if on_console_log:
                    try:
                        on_console_log(line)
                    except Exception:
                        pass

                # Estimate progress based on log keywords
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

                # Write progress to task state file on each update
                elapsed = int(time.time() - start_time)
                write_task_state(task_id, {
                    "status": "running",
                    "result_dir": str(result_dir),
                    "progress": progress,
                    "filename": filename,
                    "original_filename": original_filename,
                    "timestamp": timestamp,
                    "elapsed": elapsed
                })

                if on_progress:
                    on_progress(progress)

                print(line)

        thread = threading.Thread(target=_read_output)
        thread.start()
        process.wait()
        thread.join()

        # Calculate total runtime
        runtime = int(time.time() - start_time)

        if process.returncode != 0:
            write_task_state(task_id, {
                "status": "error", 
                "message": "DeepSeek OCR execution failed",
                "filename": filename,
                "original_filename": original_filename,
                "timestamp": timestamp,
                "runtime": runtime
            })
            raise RuntimeError("DeepSeek OCR execution failed")

        files = list_result_files(result_dir)
        write_task_state(task_id, {
            "status": "finished", 
            "result_dir": str(result_dir), 
            "files": files,
            "filename": filename,
            "original_filename": original_filename,
            "timestamp": timestamp,
            "runtime": runtime
        })

        print(f"✅ Task completed: {task_id} (runtime: {runtime}s)")
        return {
            "status": "finished", 
            "task_id": task_id, 
            "result_dir": str(result_dir), 
            "files": files,
            "runtime": runtime
        }

    except Exception as e:
        runtime = int(time.time() - start_time)
        write_task_state(task_id, {
            "status": "error", 
            "message": str(e),
            "filename": filename,
            "original_filename": original_filename,
            "timestamp": timestamp,
            "runtime": runtime
        })
        print(f"❌ Task error {task_id}: {e}")
        return {"status": "error", "message": str(e), "runtime": runtime}
