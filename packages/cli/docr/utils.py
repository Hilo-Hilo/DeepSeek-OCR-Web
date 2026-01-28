import os
from typing import Optional


def derive_output_path(source_path: str, output_path: Optional[str] = None) -> str:
    if output_path:
        return output_path
    base, _ext = os.path.splitext(source_path)
    return f"{base}.md"


def safe_filename(path: str) -> str:
    return os.path.basename(path)


def ensure_md_extension(path: str) -> str:
    base, ext = os.path.splitext(path)
    if ext.lower() in {".md", ".mmd"}:
        return f"{base}.md"
    return f"{path}.md"
