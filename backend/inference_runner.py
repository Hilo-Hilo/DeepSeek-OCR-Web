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
- Task cancellation
"""

import json
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, Optional, Dict, Any
from datetime import datetime, timezone

from config_loader import MODEL_PATH, LOGS_DIR
from file_manager import detect_file_type, create_result_dir, list_result_files

# Track running processes for cancellation
_running_processes: Dict[str, subprocess.Popen] = {}

# ====== Progress Parsing Helpers ======
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_OCR_INFER_PCT_RE = re.compile(r"ocr inference:\s*(\d{1,3})%")
_SAVING_PCT_RE = re.compile(r"saving results:\s*(\d{1,3})%")

def _strip_ansi(s: str) -> str:
    return _ANSI_RE.sub("", s)

def _clamp_pct(p: int) -> int:
    return max(0, min(100, p))

def _map_stage_pct(stage: str, pct: int) -> int:
    """Map stage-specific tqdm percentages into a monotonic overall 0-100 progress."""
    pct = _clamp_pct(pct)
    if stage == "ocr":
        # OCR inference is the bulk of runtime: map 0-100 -> 20-85
        return 20 + int(pct * 0.65)
    if stage == "save":
        # Saving is the tail: map 0-100 -> 85-99
        return 85 + int(pct * 0.14)
    return pct

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
    # Atomic write to avoid readers seeing partially-written JSON (which can
    # cause transient "missing task" or failed cancel/progress reads).
    tmp_path = state_path.with_suffix(".json.tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
    tmp_path.replace(state_path)
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


def cancel_ocr_task(task_id: str) -> bool:
    """Cancel a running OCR task by killing its subprocess"""
    # Check if process is tracked (normal case)
    process = _running_processes.get(task_id)
    if process is not None:
        try:
            # Mark cancelled immediately so the worker can observe it even if
            # the subprocess exits before we finish termination handling.
            state = read_task_state(task_id)
            if state and state.get("status") == "running":
                state["status"] = "cancelled"
                state["message"] = "Task was cancelled by user"
                write_task_state(task_id, state)

            # Kill the process
            if process.poll() is None:  # Process is still running
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()  # Force kill if terminate doesn't work

            # Remove tracking entry (race-safe)
            _running_processes.pop(task_id, None)

            print(f"🛑 Task {task_id} cancelled")
            return True
        except Exception as e:
            print(f"❌ Failed to cancel task {task_id}: {e}")
            return False
        finally:
            _running_processes.pop(task_id, None)
    
    # Try to read PID from state file as fallback
    state = read_task_state(task_id)
    if state and "pid" in state:
        try:
            pid = state["pid"]
            if state.get("status") == "running":
                state["status"] = "cancelled"
                state["message"] = "Task was cancelled by user"
                write_task_state(task_id, state)
            os.kill(pid, signal.SIGTERM)
            print(f"🛑 Task {task_id} cancelled via PID {pid}")
            return True
        except (ProcessLookupError, PermissionError) as e:
            print(f"❌ Failed to kill process {state.get('pid')}: {e}")
            return False
    
    return False


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
    timestamp = datetime.now(timezone.utc).isoformat()
    
    try:
        # If the user cancelled immediately after /api/start (before the subprocess
        # is spawned), respect that cancellation and do not start work.
        existing_state = read_task_state(task_id)
        if existing_state and existing_state.get("status") == "cancelled":
            runtime = int(time.time() - start_time)
            print(f"🛑 Task {task_id} was cancelled before start")
            return {"status": "cancelled", "message": "Task was cancelled by user", "runtime": runtime}

        result_dir = create_result_dir(prefix=f"ocr_task_{task_id}")

        # Cancellation can arrive after we've started but before we write our first
        # state update. Don't overwrite a cancelled state.
        after_dir_state = read_task_state(task_id)
        if after_dir_state and after_dir_state.get("status") == "cancelled":
            runtime = int(time.time() - start_time)
            print(f"🛑 Task {task_id} cancelled before initial state write")
            return {"status": "cancelled", "message": "Task was cancelled by user", "runtime": runtime}

        write_task_state(task_id, {
            "status": "running", 
            "result_dir": str(result_dir),
            "filename": filename,
            "original_filename": original_filename,
            "timestamp": timestamp,
            "start_time": start_time
        })

        # Cancellation could be requested after /api/start but before the subprocess
        # is spawned. Respect it to avoid doing unnecessary work.
        mid_state = read_task_state(task_id)
        if mid_state and mid_state.get("status") == "cancelled":
            runtime = int(time.time() - start_time)
            print(f"🛑 Task {task_id} cancelled before subprocess start")
            return {"status": "cancelled", "message": "Task was cancelled by user", "runtime": runtime}

        file_type = detect_file_type(input_path)
        script_path = PDF_SCRIPT if file_type == "pdf" else IMAGE_SCRIPT

        override_config(MODEL_PATH, input_path, str(result_dir), prompt)

        print(f"🚀 Starting DeepSeek OCR task ({file_type.upper()})")
        print(f"📄 Using script: {script_path}")
        print(f"📁 Output path: {result_dir}")

        # Re-check cancellation just before spawning the subprocess.
        pre_spawn_state = read_task_state(task_id)
        if pre_spawn_state and pre_spawn_state.get("status") == "cancelled":
            runtime = int(time.time() - start_time)
            print(f"🛑 Task {task_id} cancelled before spawn")
            return {"status": "cancelled", "message": "Task was cancelled by user", "runtime": runtime}

        command = ["python", str(script_path)]

        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1,
        )
        
        # Track the process for cancellation
        _running_processes[task_id] = process
        
        # Store PID in task state for recovery
        write_task_state(task_id, {
            "status": "running", 
            "result_dir": str(result_dir),
            "filename": filename,
            "original_filename": original_filename,
            "timestamp": timestamp,
            "start_time": start_time,
            "pid": process.pid
        })

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

                # Estimate progress based on log output.
                # Prefer stage-aware tqdm parsing (PDF/image HF scripts), with a safe keyword fallback.
                plain = _strip_ansi(line)
                lower = plain.lower()

                # Stage-aware percentage parsing (tqdm output).
                m = _OCR_INFER_PCT_RE.search(lower)
                if m:
                    try:
                        pct = int(m.group(1))
                        progress = max(progress, _map_stage_pct("ocr", pct))
                    except Exception:
                        pass
                else:
                    m = _SAVING_PCT_RE.search(lower)
                    if m:
                        try:
                            pct = int(m.group(1))
                            progress = max(progress, _map_stage_pct("save", pct))
                        except Exception:
                            pass

                # Keyword fallbacks / milestones (monotonic).
                if "loading deepseek ocr model" in lower or ("loading" in lower and progress < 10):
                    progress = max(progress, 10)
                if "loaded" in lower and "pages" in lower:
                    progress = max(progress, 15)
                if "running ocr inference" in lower:
                    progress = max(progress, 20)
                if "processing complete" in lower:
                    progress = max(progress, 90)
                if "saving results" in lower or "save results" in lower:
                    progress = max(progress, 85)
                if "result_with_boxes" in lower or "task completed" in lower:
                    progress = 100

                # Write progress to task state file on each update
                elapsed = int(time.time() - start_time)
                current_state = read_task_state(task_id)
                if current_state and current_state.get("status") == "cancelled":
                    # Don't overwrite cancellation state with running updates.
                    return
                write_task_state(task_id, {
                    "status": "running",
                    "result_dir": str(result_dir),
                    "progress": progress,
                    "filename": filename,
                    "original_filename": original_filename,
                    "timestamp": timestamp,
                    "start_time": start_time,
                    "pid": process.pid,
                    "elapsed": elapsed
                })

                if on_progress:
                    on_progress(progress)

                print(line)

        thread = threading.Thread(target=_read_output)
        thread.start()
        process.wait()
        thread.join()
        
        # Clean up process tracking
        if task_id in _running_processes:
            del _running_processes[task_id]

        # Calculate total runtime
        runtime = int(time.time() - start_time)
        
        # Check if task was cancelled
        current_state = read_task_state(task_id)
        if current_state and current_state.get("status") == "cancelled":
            print(f"🛑 Task {task_id} was cancelled")
            return {"status": "cancelled", "message": "Task was cancelled by user", "runtime": runtime}

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
        # Clean up process tracking
        if task_id in _running_processes:
            del _running_processes[task_id]
            
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
