#!/usr/bin/env python3
"""Background worker that polls for task completion and downloads result."""

import os
import sys
import time

def main():
    if len(sys.argv) < 4:
        print("Usage: background.py <base_url> <task_id> <output_path>", file=sys.stderr)
        sys.exit(1)
    
    base_url = sys.argv[1]
    task_id = sys.argv[2]
    output_path = sys.argv[3]
    
    import requests
    
    # Poll until complete
    while True:
        try:
            resp = requests.get(f"{base_url}/api/progress/{task_id}", timeout=30)
            resp.raise_for_status()
            data = resp.json()
            state = data.get("state") or data.get("status")
            if state in {"completed", "succeeded", "success", "done", "finished"}:
                break
            if state in {"failed", "error", "canceled", "cancelled"}:
                sys.exit(1)
        except Exception:
            pass
        time.sleep(5)
    
    # Download result
    try:
        resp = requests.get(f"{base_url}/api/result/{task_id}", timeout=30)
        resp.raise_for_status()
        result = resp.json()
        result_dir = result.get("result_dir")
        files = result.get("files") or []
        
        # Pick markdown file
        md_name = None
        for name in files:
            if name.lower().endswith((".md", ".mmd")):
                md_name = name
                break
        if not md_name and files:
            md_name = files[0]
        
        if not result_dir or not md_name:
            sys.exit(1)
        
        # Fetch content
        resp = requests.get(f"{base_url}/api/file/content", params={"path": f"{result_dir}/{md_name}"}, timeout=30)
        resp.raise_for_status()
        content = resp.json()
        text = content.get("content", "")
        
        # Write to output
        os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(text)
        
        print(f"Saved: {output_path}")
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
