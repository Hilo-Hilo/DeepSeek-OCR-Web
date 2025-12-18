"""
file_manager.py
---------------
This module is responsible for:
1. Unified management of user upload file saving;
2. Automatically creating independent result folders for each inference task;
3. Providing utility functions for path generation, file type detection, etc.;
4. Ensuring filename safety and preventing naming conflicts.
"""

import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Tuple

from config_loader import UPLOAD_DIR, RESULTS_DIR


# ========== Step 1. File Type Detection ==========
def detect_file_type(file_path: str) -> str:
    """
    Automatically determine file type based on extension
    Returns: 'pdf' or 'image'
    """
    ext = Path(file_path).suffix.lower()
    if ext in [".pdf"]:
        return "pdf"
    elif ext in [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"]:
        return "image"
    else:
        raise ValueError(f"❌ Unsupported file type: {ext}")


# ========== Step 2. Save Uploaded File ==========
def save_uploaded_file(file, filename: str = None) -> Tuple[str, str, str]:
    """
    Save uploaded file to workspace/uploads/
    - Automatically generate unique filename (avoid duplication)
    - Returns: (save_path, file_type, original_filename)
    """
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # Store original filename
    original_filename = file.filename
    
    # Generate unique filename
    ext = Path(file.filename).suffix
    if not filename:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"user_upload_{timestamp}_{unique_id}{ext}"
    
    file_path = Path(UPLOAD_DIR) / filename
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    file_type = detect_file_type(str(file_path))
    
    print(f"📤 File saved: {file_path} ({file_type}) - Original: {original_filename}")
    
    return str(file_path), file_type, original_filename


# ========== Step 3. Create Result Directory ==========
def create_result_dir(prefix: str = "task") -> str:
    """
    Create independent result folder for each inference task
    Example: workspace/results/task_20251022_153045_ab12cd34/
    """
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    unique_id = str(uuid.uuid4())[:8]
    dir_name = f"{prefix}_{timestamp}_{unique_id}"
    result_dir = Path(RESULTS_DIR) / dir_name
    os.makedirs(result_dir, exist_ok=True)
    
    print(f"📁 Result directory created: {result_dir}")
    return str(result_dir)


# ========== Step 4. Clean Up Old Files (Optional) ==========
def cleanup_uploads(max_keep: int = 10):
    """
    Clean up old files in uploads folder, keeping only the recent N files
    """
    files = sorted(Path(UPLOAD_DIR).glob("*"), key=os.path.getmtime, reverse=True)
    for old_file in files[max_keep:]:
        try:
            os.remove(old_file)
        except Exception as e:
            print(f"⚠️ Failed to delete old file: {old_file}, {e}")


# ========== Step 5. File List Utility ==========
def list_result_files(result_dir: str) -> list:
    """
    List all files in the specified result directory (recursive)
    Returns: List of relative file paths
    """
    result_dir = Path(result_dir)
    if not result_dir.exists():
        return []
    
    files = []
    for path in result_dir.rglob("*"):
        if path.is_file():
            rel_path = path.relative_to(result_dir)
            files.append(str(rel_path))
    return files


# ========== Step 6. Debug Output (Optional) ==========
if __name__ == "__main__":
    # Simulate debug run
    dummy_file_path = Path(UPLOAD_DIR) / "test.png"
    print("[DEBUG] Create result directory:", create_result_dir())
    print("[DEBUG] Current result directory file list:", list_result_files(RESULTS_DIR))
