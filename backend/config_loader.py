"""
config_loader.py
----------------
This module is responsible for:
1. Loading model path and basic configuration from .env file;
2. Automatically creating workspace directory structure (uploads / results / logs);
3. Checking configuration validity and outputting current configuration status;
4. Providing global constants for other modules to import.
"""

import os
import re
from pathlib import Path
from dotenv import load_dotenv


# ========== Step 1. Define Path Constants ==========
BASE_DIR = Path(__file__).resolve().parent.parent   # Project Root (DeepSeek-OCR)
WORKSPACE_PATH = BASE_DIR / "workspace"
UPLOAD_DIR = WORKSPACE_PATH / "uploads"
RESULTS_DIR = WORKSPACE_PATH / "results"
LOGS_DIR = WORKSPACE_PATH / "logs"


# ========== Step 2. Automatically Create .env.example File ==========
ENV_FILE = BASE_DIR / ".env"
EXAMPLE_ENV_FILE = BASE_DIR / ".env.example"

if not EXAMPLE_ENV_FILE.exists():
    with open(EXAMPLE_ENV_FILE, "w", encoding="utf-8") as f:
        f.write(
            "# DeepSeek-OCR Backend Configuration Example\n"
            "# Please copy to .env and modify MODEL_PATH path.\n\n"
            "MODEL_PATH=/root/autodl-tmp/deepseek-ocr\n"
            "DEVICE_ID=0\n"
            "MAX_CONCURRENCY=10\n"
        )


# ========== Step 3. Load .env File ==========
if not ENV_FILE.exists():
    print("[Info] .env file not found; using defaults (copy .env.example -> .env to override).")

load_dotenv(ENV_FILE)


# ========== Step 4. Read Configuration Items ==========
# MODEL_PATH can be either:
# - a local filesystem path (mounted into Docker), OR
# - a Hugging Face model id (downloaded on first use via transformers)
DEFAULT_MODEL_PATH = str(BASE_DIR / "deepseek-ocr")
MODEL_PATH = os.getenv("MODEL_PATH", DEFAULT_MODEL_PATH)
DEVICE_ID = os.getenv("DEVICE_ID", "0")
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "10"))


# ========== Step 5. Check Model Path Validity ==========
if MODEL_PATH is None or str(MODEL_PATH).strip() == "":
    raise ValueError("Error: MODEL_PATH is empty. Set it to a local path or a Hugging Face model id.")

_HF_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]+/[A-Za-z0-9][A-Za-z0-9_.-]+$")

def _is_probably_hf_model_id(s: str) -> bool:
    s = (s or "").strip()
    if not s:
        return False
    # Common local-path prefixes.
    if s.startswith(("/", "./", "../", "~")):
        return False
    return bool(_HF_MODEL_ID_RE.match(s))

_model_path_str = str(MODEL_PATH).strip()
if not Path(_model_path_str).exists():
    if _is_probably_hf_model_id(_model_path_str):
        # Normal when using a HF model id like "deepseek-ai/DeepSeek-OCR-2".
        print(f"[Info] MODEL_PATH not found on disk: {_model_path_str}")
        print("[Info] Assuming MODEL_PATH is a Hugging Face model id; weights will be downloaded on first use.")
    else:
        print(f"[Warning] Specified model path does not exist: {_model_path_str}")
        print("[Warning] Download DeepSeek-OCR-2 weights to this directory, or set MODEL_PATH to a HF model id.")


# ========== Step 6. Automatically Create Working Directories ==========
for directory in [WORKSPACE_PATH, UPLOAD_DIR, RESULTS_DIR, LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)


# ========== Step 7. Debug Output (Print Current Effective Configuration) ==========
print("=" * 60)
print("DeepSeek-OCR Backend Configuration Loaded")
print(f"Model Path:      {MODEL_PATH}")
print(f"GPU Device:     {DEVICE_ID}")
print(f"Max Concurrency: {MAX_CONCURRENCY}")
print(f"Workspace Path:  {WORKSPACE_PATH}")
print("=" * 60)


# ========== Step 8. Export Constants for Global Use ==========
__all__ = [
    "MODEL_PATH",
    "DEVICE_ID",
    "MAX_CONCURRENCY",
    "WORKSPACE_PATH",
    "UPLOAD_DIR",
    "RESULTS_DIR",
    "LOGS_DIR"
]
