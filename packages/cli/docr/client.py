import os
import time
from typing import Any, Dict, List, Optional

import requests
from websocket import create_connection


DEFAULT_BASE_URL = "http://100.111.126.23:8002"


class DocrClient:
    def __init__(self, base_url: Optional[str] = None, timeout: int = 30) -> None:
        self.base_url = (base_url or os.getenv("DGX_OCR_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()

    def upload(self, file_path: str) -> Dict[str, Any]:
        url = f"{self.base_url}/api/upload"
        with open(file_path, "rb") as f:
            files = {"file": f}
            resp = self.session.post(url, files=files, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def start(self, file_path: str, original_filename: str, prompt: str = "") -> Dict[str, Any]:
        url = f"{self.base_url}/api/start"
        # Use default prompt if none provided (same as MCP server)
        effective_prompt = prompt or "<image>\nFree OCR."
        payload = {
            "file_path": file_path,
            "prompt": effective_prompt,
            "original_filename": original_filename,
        }
        resp = self.session.post(url, json=payload, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def progress(self, task_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/api/progress/{task_id}"
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def result(self, task_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/api/result/{task_id}"
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def history(self) -> Dict[str, Any]:
        url = f"{self.base_url}/api/history"
        resp = self.session.get(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def cancel(self, task_id: str) -> Dict[str, Any]:
        url = f"{self.base_url}/api/cancel/{task_id}"
        resp = self.session.post(url, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def file_content(self, path: str) -> Dict[str, Any]:
        url = f"{self.base_url}/api/file/content"
        resp = self.session.get(url, params={"path": path}, timeout=self.timeout)
        resp.raise_for_status()
        return resp.json()

    def ws_logs(self, task_id: str, duration_s: int = 30) -> List[str]:
        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_url}/ws/console/{task_id}"
        lines: List[str] = []
        end_time = time.time() + duration_s
        ws = create_connection(ws_url, timeout=5)
        try:
            ws.settimeout(1)
            while time.time() < end_time:
                try:
                    msg = ws.recv()
                except Exception:
                    continue
                if msg is None:
                    continue
                lines.append(str(msg))
        finally:
            try:
                ws.close()
            except Exception:
                pass
        return lines


def pick_markdown_file(files: List[str]) -> Optional[str]:
    if not files:
        return None
    for name in files:
        lowered = name.lower()
        if lowered.endswith(".md") or lowered.endswith(".mmd"):
            return name
    return files[0]
