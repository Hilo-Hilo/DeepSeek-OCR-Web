from __future__ import annotations

import os
import time
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from mcp.server.fastmcp import FastMCP

DEFAULT_BASE_URL = "http://100.111.126.23:8002"
DEFAULT_TIMEOUT_S = 600
POLL_INTERVAL_S = 2
REQUEST_TIMEOUT_S = 30

mcp = FastMCP("dgx-ocr-mcp")


def _base_url() -> str:
    return os.getenv("DGX_OCR_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _request_json(resp: requests.Response) -> Dict[str, Any]:
    try:
        payload = resp.json()
    except Exception as exc:
        raise RuntimeError(f"Unexpected response (status {resp.status_code})") from exc
    return payload


def _download_to_temp(url: str) -> Tuple[Path, Path]:
    tmp_dir = Path(tempfile.mkdtemp(prefix="dgx_ocr_mcp_"))
    name = Path(url.split("?")[0]).name or "download"
    suffix = Path(name).suffix
    if not suffix:
        suffix = ".bin"
    tmp_path = tmp_dir / f"source{suffix}"
    with requests.get(url, stream=True, timeout=REQUEST_TIMEOUT_S) as resp:
        resp.raise_for_status()
        with tmp_path.open("wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
    return tmp_path, tmp_dir


def _upload_file(file_path: Path) -> Dict[str, Any]:
    url = f"{_base_url()}/api/upload"
    with file_path.open("rb") as f:
        files = {"file": (file_path.name, f)}
        resp = requests.post(url, files=files, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    payload = _request_json(resp)
    if payload.get("status") != "success":
        raise RuntimeError(f"Upload failed: {payload}")
    return payload


def _start_task(file_path: str, prompt: str, original_filename: str) -> str:
    url = f"{_base_url()}/api/start"
    resp = requests.post(
        url,
        json={
            "file_path": file_path,
            "prompt": prompt,
            "original_filename": original_filename,
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    resp.raise_for_status()
    payload = _request_json(resp)
    if payload.get("status") != "running":
        raise RuntimeError(f"Start failed: {payload}")
    task_id = payload.get("task_id")
    if not task_id:
        raise RuntimeError(f"Missing task_id in response: {payload}")
    return str(task_id)


def _poll_until_finished(task_id: str, timeout_s: int) -> None:
    url = f"{_base_url()}/api/progress/{task_id}"
    start = time.time()
    while True:
        if time.time() - start > timeout_s:
            raise TimeoutError(f"Timed out after {timeout_s}s waiting for task {task_id}")
        resp = requests.get(url, timeout=REQUEST_TIMEOUT_S)
        resp.raise_for_status()
        payload = _request_json(resp)
        if payload.get("status") != "success":
            raise RuntimeError(f"Progress failed: {payload}")
        state = payload.get("state")
        if state == "finished":
            return
        if state in {"error", "cancelled"}:
            raise RuntimeError(f"Task {task_id} ended with state {state}")
        time.sleep(POLL_INTERVAL_S)


def _get_result(task_id: str) -> Dict[str, Any]:
    url = f"{_base_url()}/api/result/{task_id}"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    payload = _request_json(resp)
    if payload.get("status") != "success":
        raise RuntimeError(f"Result failed: {payload}")
    return payload


def _pick_markdown_file(files: List[str]) -> Optional[str]:
    for ext in (".mmd", ".md", ".txt"):
        for name in files:
            if name.lower().endswith(ext):
                return name
    return None


def _fetch_text_file(path: str) -> str:
    url = f"{_base_url()}/api/file/content"
    resp = requests.get(url, params={"path": path}, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    try:
        payload = resp.json()
    except Exception:
        return resp.text
    return str(payload.get("content", ""))


@mcp.tool()
def convert_to_markdown(
    source_path: Optional[str] = None,
    source_url: Optional[str] = None,
    prompt: Optional[str] = None,
    timeout_s: Optional[int] = None,
) -> Dict[str, Any]:
    """Convert a PDF or image to markdown using the DGX OCR backend."""
    if bool(source_path) == bool(source_url):
        raise ValueError("Provide exactly one of source_path or source_url")

    resolved_timeout = int(timeout_s) if timeout_s is not None else DEFAULT_TIMEOUT_S
    cleanup_dir: Optional[Path] = None
    local_path: Optional[Path] = None

    try:
        if source_url:
            local_path, cleanup_dir = _download_to_temp(source_url)
        else:
            local_path = Path(source_path).expanduser().resolve()
            if not local_path.exists():
                raise FileNotFoundError(f"Source path does not exist: {local_path}")

        upload_payload = _upload_file(local_path)
        file_path = upload_payload.get("file_path")
        original_filename = upload_payload.get("original_filename", "")
        if not file_path:
            raise RuntimeError(f"Upload did not return file_path: {upload_payload}")

        task_id = _start_task(file_path=file_path, prompt=prompt or "<image>\nFree OCR.", original_filename=original_filename)
        _poll_until_finished(task_id, resolved_timeout)
        result_payload = _get_result(task_id)

        result_dir = result_payload.get("result_dir", "")
        files = result_payload.get("files", []) or []
        selected = _pick_markdown_file(files)
        if not selected:
            raise RuntimeError(f"No markdown-like output found in files: {files}")

        full_path = str(Path(result_dir) / selected)
        markdown_text = _fetch_text_file(full_path)

        return {
            "markdown": markdown_text,
            "task_id": task_id,
            "files": files,
            "result_dir": result_dir,
            "selected_file": selected,
        }
    finally:
        if cleanup_dir and cleanup_dir.exists():
            for child in cleanup_dir.iterdir():
                try:
                    child.unlink()
                except Exception:
                    pass
            try:
                cleanup_dir.rmdir()
            except Exception:
                pass


@mcp.tool()
def list_recent_jobs(limit: int = 10) -> Dict[str, Any]:
    """Return the most recent OCR jobs from the DGX OCR backend."""
    url = f"{_base_url()}/api/history"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    payload = _request_json(resp)
    if payload.get("status") != "success":
        raise RuntimeError(f"History failed: {payload}")
    jobs = payload.get("jobs", []) or []
    return {"jobs": jobs[: max(0, int(limit))]}


def run() -> None:
    mcp.run()


if __name__ == "__main__":
    run()
