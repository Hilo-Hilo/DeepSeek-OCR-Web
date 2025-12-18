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
    print("[⚠️ Warning] .env file not found, created example .env.example.")
    print("Please copy .env.example -> .env and fill in MODEL_PATH, then restart.")

load_dotenv(ENV_FILE)


# ========== Step 4. Read Configuration Items ==========
MODEL_PATH = os.getenv("MODEL_PATH", None)
DEVICE_ID = os.getenv("DEVICE_ID", "0")
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "10"))


# ========== Step 5. Check Model Path Validity ==========
if MODEL_PATH is None or MODEL_PATH.strip() == "":
    raise ValueError("❌ MODEL_PATH not set in .env, please fill in model path and restart service.")

if not Path(MODEL_PATH).exists():
    print(f"[⚠️ Warning] Specified model path does not exist: {MODEL_PATH}")
    print("Please ensure DeepSeek-OCR model weights are downloaded.")


# ========== Step 6. Automatically Create Working Directories ==========
for directory in [WORKSPACE_PATH, UPLOAD_DIR, RESULTS_DIR, LOGS_DIR]:
    os.makedirs(directory, exist_ok=True)


# ========== Step 7. Debug Output (Print Current Effective Configuration) ==========
print("=" * 60)
print("🔧 DeepSeek-OCR Backend Configuration Loaded")
print(f"📁 Model Path:      {MODEL_PATH}")
print(f"🖥️  GPU Device:     {DEVICE_ID}")
print(f"⚙️  Max Concurrency: {MAX_CONCURRENCY}")
print(f"📂 Workspace Path:  {WORKSPACE_PATH}")
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
