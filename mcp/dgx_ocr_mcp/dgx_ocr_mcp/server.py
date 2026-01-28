from __future__ import annotations

import os
import time
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests
from mcp.server.fastmcp import FastMCP

DEFAULT_BASE_URL = "http://100.111.126.23:8002"
# Default wait timeout (used only when wait=True)
DEFAULT_TIMEOUT_S = 7200
POLL_INTERVAL_S = 2
REQUEST_TIMEOUT_S = 30

mcp = FastMCP("dgx-ocr-mcp")

_job_lock = threading.Lock()
_jobs: Dict[str, Dict[str, Any]] = {}


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
    suffix = Path(name).suffix or ".bin"
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


def _get_progress(task_id: str) -> Dict[str, Any]:
    url = f"{_base_url()}/api/progress/{task_id}"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_S)
    resp.raise_for_status()
    payload = _request_json(resp)
    if payload.get("status") != "success":
        raise RuntimeError(f"Progress failed: {payload}")
    return payload


def _poll_until_terminal(task_id: str, timeout_s: int, job_id: Optional[str] = None) -> Dict[str, Any]:
    start = time.time()
    while True:
        if time.time() - start > timeout_s:
            raise TimeoutError(f"Timed out after {timeout_s}s waiting for task {task_id}")
        if job_id:
            with _job_lock:
                job = _jobs.get(job_id)
                if job and job.get("status") == "cancelled":
                    return {"state": "cancelled"}
        payload = _get_progress(task_id)
        state = payload.get("state")
        if state in {"finished", "error", "cancelled"}:
            return payload
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


def _resolve_output_path(
    local_path: Optional[Path],
    source_url: Optional[str],
    save_to_dir: Optional[str],
    output_path: Optional[str],
) -> Path:
    if output_path:
        return Path(output_path).expanduser().resolve()

    if save_to_dir:
        dir_path = Path(save_to_dir).expanduser().resolve()
        name_source = local_path.name if local_path else Path((source_url or "").split("?")[0]).name
        stem = Path(name_source or "output").stem or "output"
        return dir_path / f"{stem}.md"

    if local_path:
        return local_path.with_name(f"{local_path.stem}.md")

    raise ValueError("source_url requires save_to_dir or output_path")


def _save_markdown(markdown_text: str, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown_text, encoding="utf-8")


def _cleanup_dir(path: Optional[Path]) -> None:
    if not path or not path.exists():
        return
    try:
        for child in path.iterdir():
            try:
                child.unlink()
            except Exception:
                pass
        path.rmdir()
    except Exception:
        pass


def _begin_job(
    *,
    source_path: Optional[str],
    source_url: Optional[str],
    prompt: Optional[str],
    save_to_dir: Optional[str],
    output_path: Optional[str],
) -> Tuple[Path, Optional[Path], str, Path]:
    """Synchronous start phase: resolve input, resolve output, upload, start, return (local_path, cleanup_dir, task_id, saved_path)."""
    if bool(source_path) == bool(source_url):
        raise ValueError("Provide exactly one of source_path or source_url")

    if source_url and not save_to_dir and not output_path:
        raise ValueError("source_url requires save_to_dir or output_path")

    cleanup_dir: Optional[Path] = None
    if source_url:
        local_path, cleanup_dir = _download_to_temp(source_url)
    else:
        local_path = Path(source_path).expanduser().resolve()
        if not local_path.exists():
            raise FileNotFoundError(f"Source path does not exist: {local_path}")

    saved_path = _resolve_output_path(
        local_path=local_path,
        source_url=source_url,
        save_to_dir=save_to_dir,
        output_path=output_path,
    )

    upload_payload = _upload_file(local_path)
    file_path = upload_payload.get("file_path")
    original_filename = upload_payload.get("original_filename", "")
    if not file_path:
        raise RuntimeError(f"Upload did not return file_path: {upload_payload}")

    task_id = _start_task(
        file_path=file_path,
        prompt=prompt or "<image>\nFree OCR.",
        original_filename=original_filename,
    )

    return local_path, cleanup_dir, task_id, saved_path


def _run_waiting_job(
    *,
    source_path: Optional[str],
    source_url: Optional[str],
    prompt: Optional[str],
    timeout_s: Optional[int],
    save_to_dir: Optional[str],
    output_path: Optional[str],
) -> Dict[str, Any]:
    local_path, cleanup_dir, task_id, saved_path = _begin_job(
        source_path=source_path,
        source_url=source_url,
        prompt=prompt,
        save_to_dir=save_to_dir,
        output_path=output_path,
    )

    try:
        resolved_timeout = int(timeout_s) if timeout_s is not None else DEFAULT_TIMEOUT_S
        state = _poll_until_done(task_id, resolved_timeout, cancel_flag=lambda: False)
        if state == "cancelled":
            return {"status": "cancelled", "task_id": task_id, "saved_path": str(saved_path)}
        if state != "finished":
            raise RuntimeError(f"Task {task_id} ended with state {state}")

        result_payload = _get_result(task_id)
        result_dir = result_payload.get("result_dir", "")
        files = result_payload.get("files", []) or []
        selected = _pick_markdown_file(files)
        if not selected:
            raise RuntimeError(f"No markdown-like output found in files: {files}")

        full_path = str(Path(result_dir) / selected)
        markdown_text = _fetch_text_file(full_path)
        _save_markdown(markdown_text, saved_path)

        return {
            "status": "finished",
            "markdown": markdown_text,
            "task_id": task_id,
            "files": files,
            "result_dir": result_dir,
            "selected_file": selected,
            "saved_path": str(saved_path),
        }
    finally:
        _cleanup_dir(cleanup_dir)


@mcp.tool()
def convert_to_markdown(
    source_path: Optional[str] = None,
    source_url: Optional[str] = None,
    prompt: Optional[str] = None,
    timeout_s: Optional[int] = None,
    wait: bool = False,
    save_to_dir: Optional[str] = None,
    output_path: Optional[str] = None,
) -> Dict[str, Any]:
    """Convert a PDF or image to markdown using the DGX OCR backend.

    Default behavior (wait=False):
    - Starts the backend task synchronously (upload + /api/start)
    - Returns immediately with {job_id, status:"running", task_id, saved_path}
    - The MCP server continues in the background and saves markdown to saved_path when done.

    wait=True:
    - Blocks until finished (up to timeout_s, default 7200s) and returns the full result.
    """

    if wait:
        return _run_waiting_job(
            source_path=source_path,
            source_url=source_url,
            prompt=prompt,
            timeout_s=timeout_s,
            save_to_dir=save_to_dir,
            output_path=output_path,
        )

    # Start phase MUST succeed before we create a job entry.
    local_path, cleanup_dir, task_id, saved_path = _begin_job(
        source_path=source_path,
        source_url=source_url,
        prompt=prompt,
        save_to_dir=save_to_dir,
        output_path=output_path,
    )

    job_id = str(uuid.uuid4())
    with _job_lock:
        _jobs[job_id] = {
            "status": "running",
            "task_id": task_id,
            "saved_path": str(saved_path),
            "result": None,
            "error": None,
            "cancel_requested": False,
        }

    def cancel_flag() -> bool:
        with _job_lock:
            job = _jobs.get(job_id) or {}
            return bool(job.get("cancel_requested"))

    def runner() -> None:
        try:
            resolved_timeout = int(timeout_s) if timeout_s is not None else DEFAULT_TIMEOUT_S
            state = _poll_until_done(task_id, resolved_timeout, cancel_flag=cancel_flag)
            if state == "cancelled":
                with _job_lock:
                    job = _jobs.get(job_id)
                    if job:
                        job["status"] = "cancelled"
                return
            if state != "finished":
                raise RuntimeError(f"Task {task_id} ended with state {state}")

            result_payload = _get_result(task_id)
            result_dir = result_payload.get("result_dir", "")
            files = result_payload.get("files", []) or []
            selected = _pick_markdown_file(files)
            if not selected:
                raise RuntimeError(f"No markdown-like output found in files: {files}")

            full_path = str(Path(result_dir) / selected)
            markdown_text = _fetch_text_file(full_path)
            _save_markdown(markdown_text, saved_path)

            result = {
                "status": "finished",
                "markdown": markdown_text,
                "task_id": task_id,
                "files": files,
                "result_dir": result_dir,
                "selected_file": selected,
                "saved_path": str(saved_path),
            }

            with _job_lock:
                job = _jobs.get(job_id)
                if job and job.get("status") != "cancelled":
                    job["status"] = "finished"
                    job["result"] = result
        except Exception as exc:
            with _job_lock:
                job = _jobs.get(job_id)
                if job and job.get("status") != "cancelled":
                    job["status"] = "error"
                    job["error"] = str(exc)
        finally:
            _cleanup_dir(cleanup_dir)

    threading.Thread(target=runner, daemon=True).start()

    return {
        "job_id": job_id,
        "status": "running",
        "task_id": task_id,
        "saved_path": str(saved_path),
    }


@mcp.tool()
def get_job_status(job_id: str) -> Dict[str, Any]:
    """Return status for a previously submitted job."""
    with _job_lock:
        job = _jobs.get(job_id)
        if not job:
            raise KeyError(f"Unknown job_id: {job_id}")
        task_id = job.get("task_id")
        status = job.get("status")
        error = job.get("error")
        saved_path = job.get("saved_path")

    progress_val: Optional[int] = None
    state_val: Optional[str] = None
    if task_id and status == "running":
        try:
            p = _progress(str(task_id))
            progress_val = p.get("progress")
            state_val = p.get("state")
        except Exception:
            progress_val = None
            state_val = None

    return {
        "job_id": job_id,
        "status": status,
        "task_id": task_id,
        "saved_path": saved_path,
        "progress": progress_val,
        "state": state_val,
        "error": error,
    }


@mcp.tool()
def get_job_result(job_id: str) -> Dict[str, Any]:
    """Return full job result once finished."""
    with _job_lock:
        job = _jobs.get(job_id)
        if not job:
            raise KeyError(f"Unknown job_id: {job_id}")
        status = job.get("status")
        if status == "running":
            return {"job_id": job_id, "status": "running"}
        if status == "error":
            return {"job_id": job_id, "status": "error", "error": job.get("error")}
        if status == "cancelled":
            return {"job_id": job_id, "status": "cancelled"}
        return {"job_id": job_id, "status": status, "result": job.get("result")}


@mcp.tool()
def cancel_job(job_id: str) -> Dict[str, Any]:
    """Cancel a running job and notify the backend if possible."""
    with _job_lock:
        job = _jobs.get(job_id)
        if not job:
            raise KeyError(f"Unknown job_id: {job_id}")
        job["cancel_requested"] = True
        task_id = job.get("task_id")

    cancel_response: Optional[Dict[str, Any]] = None
    if task_id:
        url = f"{_base_url()}/api/cancel/{task_id}"
        resp = requests.post(url, timeout=REQUEST_TIMEOUT_S)
        resp.raise_for_status()
        cancel_response = _request_json(resp)

    with _job_lock:
        job = _jobs.get(job_id)
        if job:
            job["status"] = "cancelled"

    return {
        "job_id": job_id,
        "status": "cancelled",
        "task_id": task_id,
        "cancel_response": cancel_response,
    }


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
