"""
file_manager.py
---------------
该模块负责：
1. 统一管理用户上传文件的保存；
2. 自动为每次推理创建独立的结果文件夹；
3. 提供路径生成、文件类型判断等工具函数；
4. 保证文件名安全、防止命名冲突。
"""

import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Tuple

from config_loader import UPLOAD_DIR, RESULTS_DIR


# ========== Step 1. 文件类型判断 ==========
def detect_file_type(file_path: str) -> str:
    """
    根据扩展名自动判断文件类型
    返回值: 'pdf' 或 'image'
    """
    ext = Path(file_path).suffix.lower()
    if ext in [".pdf"]:
        return "pdf"
    elif ext in [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"]:
        return "image"
    else:
        raise ValueError(f"❌ 不支持的文件类型: {ext}")


# ========== Step 2. 保存上传文件 ==========
def save_uploaded_file(file, filename: str = None) -> Tuple[str, str, str]:
    """
    保存上传文件到 workspace/uploads/
    - 自动生成唯一文件名（避免重复）
    - 返回: (保存路径, 文件类型, 原始文件名)
    """
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    
    # Store original filename
    original_filename = file.filename
    
    # 生成唯一文件名
    ext = Path(file.filename).suffix
    if not filename:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        unique_id = str(uuid.uuid4())[:8]
        filename = f"user_upload_{timestamp}_{unique_id}{ext}"
    
    file_path = Path(UPLOAD_DIR) / filename
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    file_type = detect_file_type(str(file_path))
    
    print(f"📤 文件已保存: {file_path} ({file_type}) - Original: {original_filename}")
    
    return str(file_path), file_type, original_filename


# ========== Step 3. 创建结果目录 ==========
def create_result_dir(prefix: str = "task") -> str:
    """
    为每次推理任务创建独立结果文件夹
    示例: workspace/results/task_20251022_153045_ab12cd34/
    """
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    unique_id = str(uuid.uuid4())[:8]
    dir_name = f"{prefix}_{timestamp}_{unique_id}"
    result_dir = Path(RESULTS_DIR) / dir_name
    os.makedirs(result_dir, exist_ok=True)
    
    print(f"📁 已创建结果目录: {result_dir}")
    return str(result_dir)


# ========== Step 4. 清理旧文件（可选） ==========
def cleanup_uploads(max_keep: int = 10):
    """
    清理 uploads 文件夹中旧文件，仅保留最近 N 个
    """
    files = sorted(Path(UPLOAD_DIR).glob("*"), key=os.path.getmtime, reverse=True)
    for old_file in files[max_keep:]:
        try:
            os.remove(old_file)
        except Exception as e:
            print(f"⚠️ 删除旧文件失败: {old_file}, {e}")


# ========== Step 5. 文件列表工具 ==========
def list_result_files(result_dir: str) -> list:
    """
    列出指定结果目录中的所有文件（递归）
    返回: 文件相对路径列表
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


# ========== Step 6. 调试输出（可选） ==========
if __name__ == "__main__":
    # 模拟调试运行
    dummy_file_path = Path(UPLOAD_DIR) / "test.png"
    print("[DEBUG] 创建结果目录:", create_result_dir())
    print("[DEBUG] 当前结果目录文件列表:", list_result_files(RESULTS_DIR))
