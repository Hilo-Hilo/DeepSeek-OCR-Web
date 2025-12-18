"""
main.py
-------
DeepSeek OCR FastAPI Backend
"""

import uuid
import asyncio
import zipfile
import io
import os
import json
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, BackgroundTasks, Response
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import Query

from file_manager import save_uploaded_file
from inference_runner import run_ocr_task, read_task_state, cancel_ocr_task, write_task_state, LOGS_DIR
from config_loader import UPLOAD_DIR, RESULTS_DIR

# Track running task processes for cancellation
running_tasks: dict = {}


app = FastAPI(title="DeepSeek OCR Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],  # Allow browser to see this header for downloads
)

active_connections = {}
console_connections = {}


async def send_progress(websocket: WebSocket, task_id: str, percent: int):
    """WebSocket real-time progress"""
    try:
        await websocket.send_json({"task_id": task_id, "progress": percent})
    except Exception:
        pass


async def send_console_log(task_id: str, message: str):
    """Send console log to connected WebSocket clients"""
    if task_id in console_connections:
        try:
            ws = console_connections[task_id]
            await ws.send_json({"type": "log", "content": message})
        except Exception:
            pass


@app.get("/api/folder")
async def get_folder_structure(path: str = Query(..., description="Result folder path")):
    """Recursively return folder structure (including subfolders)"""
    base_path = Path(path)
    if not base_path.exists() or not base_path.is_dir():
        return {"status": "error", "message": f"Invalid path: {path}"}

    def build_tree(directory: Path):
        items = []
        for entry in sorted(directory.iterdir(), key=lambda e: (e.is_file(), e.name.lower())):
            if entry.is_dir():
                items.append({
                    "name": entry.name,
                    "type": "folder",
                    "path": str(entry),
                    "children": build_tree(entry)
                })
            else:
                items.append({
                    "name": entry.name,
                    "type": "file",
                    "path": str(entry)
                })
        return items

    return {
        "status": "success",
        "path": str(base_path),
        "children": build_tree(base_path)
    }


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload file"""
    try:
        file_path, file_type, original_filename = save_uploaded_file(file)
        return {
            "status": "success", 
            "file_path": file_path, 
            "file_type": file_type,
            "original_filename": original_filename
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@app.post("/api/start")
async def start_ocr_task_endpoint(payload: dict, background_tasks: BackgroundTasks):
    """Start OCR task"""
    file_path = payload.get("file_path")
    prompt = payload.get("prompt", "<image>\nFree OCR.")
    original_filename = payload.get("original_filename", "")
    if not file_path or not Path(file_path).exists():
        return {"status": "error", "message": "File does not exist"}

    task_id = str(uuid.uuid4())[:8]
    
    # Use original filename if provided, otherwise extract from path
    filename = Path(file_path).name

    # Create an initial state file immediately so the frontend can poll/cancel
    # even before the background worker has spawned the subprocess.
    write_task_state(task_id, {
        "status": "running",
        "progress": 0,
        "filename": filename,
        "original_filename": original_filename,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    async def background_task():
        loop = asyncio.get_running_loop()

        def on_progress(p):
            ws = active_connections.get(task_id)
            if not ws:
                return
            try:
                # run_ocr_task executes in a worker thread; schedule WS sends on the main loop
                asyncio.run_coroutine_threadsafe(send_progress(ws, task_id, p), loop)
            except Exception:
                pass

        def on_console_log(msg):
            if task_id not in console_connections:
                return
            try:
                # run_ocr_task executes in a worker thread; schedule WS sends on the main loop
                asyncio.run_coroutine_threadsafe(send_console_log(task_id, msg), loop)
            except Exception:
                pass

        # Use asyncio.to_thread to run blocking OCR task without blocking event loop
        # This allows other API calls (like /api/history) to respond during processing
        result = await asyncio.to_thread(
            run_ocr_task,
            input_path=file_path, 
            task_id=task_id, 
            on_progress=on_progress, 
            prompt=prompt,
            filename=filename,
            original_filename=original_filename,
            on_console_log=on_console_log
        )
        
        # Clean up running task reference
        if task_id in running_tasks:
            del running_tasks[task_id]

        if task_id in active_connections:
            ws = active_connections[task_id]
            asyncio.create_task(ws.send_json(result))

    background_tasks.add_task(background_task)
    return {"status": "running", "task_id": task_id}


@app.websocket("/ws/progress/{task_id}")
async def websocket_progress(websocket: WebSocket, task_id: str):
    """WebSocket progress push"""
    await websocket.accept()
    active_connections[task_id] = websocket
    print(f"🌐 WebSocket connected: {task_id}")
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print(f"❌ WebSocket disconnected: {task_id}")
        if task_id in active_connections:
            del active_connections[task_id]


@app.websocket("/ws/console/{task_id}")
async def websocket_console(websocket: WebSocket, task_id: str):
    """WebSocket console output streaming"""
    await websocket.accept()
    console_connections[task_id] = websocket
    print(f"🖥️ Console WebSocket connected: {task_id}")
    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print(f"❌ Console WebSocket disconnected: {task_id}")
        if task_id in console_connections:
            del console_connections[task_id]


@app.get("/api/result/{task_id}")
async def get_result_files(task_id: str):
    """Get result files"""
    state = read_task_state(task_id)
    if not state:
        return {"status": "error", "message": "Task does not exist or state file is missing"}

    status = state.get("status", "unknown")
    if status == "running":
        return {"status": "running", "task_id": task_id}
    if status == "error":
        return {"status": "error", "message": state.get("message", "Unknown error")}
    if status != "finished":
        return {"status": "error", "message": f"Unknown status: {status}"}

    result_dir = Path(state["result_dir"])
    if not result_dir.exists():
        return {"status": "error", "message": "Result directory does not exist"}

    files = state.get("files", [])
    if not files:
        for path in result_dir.rglob("*"):
            if path.is_file():
                files.append(str(path.relative_to(result_dir)))

    return {
        "status": "success",
        "task_id": task_id,
        "state": "finished",
        "result_dir": str(result_dir),
        "files": files,
        "runtime": state.get("runtime"),
    }


@app.get("/api/progress/{task_id}")
async def get_task_progress(task_id: str):
    """Query task real-time progress"""
    state = read_task_state(task_id)
    if not state:
        return {"status": "error", "message": "Task does not exist or state file is missing"}

    progress = state.get("progress", 0)
    status = state.get("status", "unknown")

    # Make finished tasks report 100% so UIs can show a sensible final value.
    if status == "finished":
        progress = 100

    return {
        "status": "success",
        "task_id": task_id,
        "state": status,
        "progress": progress
    }


@app.head("/api/file/content")
async def head_file_content(path: str):
    """Check whether a file exists (used by frontend upload-recovery)."""
    file_path = Path(path)
    if not file_path.exists():
        return Response(status_code=404)
    return Response(status_code=200)


@app.get("/api/file/content")
async def preview_file(path: str):
    """File preview (text returns JSON; binary returns FileResponse)."""
    file_path = Path(path)
    if not file_path.exists():
        return JSONResponse({"status": "error", "message": "File does not exist"}, status_code=404)

    suffix = file_path.suffix.lower()
    if suffix in [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]:
        return FileResponse(file_path)

    # Default: treat as text content (markdown / mmd / txt / logs, etc.)
    content = file_path.read_text(encoding="utf-8", errors="ignore")
    return JSONResponse({"content": content})


@app.get("/api/history")
async def get_job_history():
    """Get all completed job history"""
    jobs = []
    
    if not LOGS_DIR.exists():
        return {"status": "success", "jobs": []}
    
    def pid_is_alive(pid: int) -> bool:
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False

    # Read all task state files
    for state_file in sorted(LOGS_DIR.glob("task_*.json"), reverse=True):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
            
            # Extract task_id from filename
            task_id = state_file.stem.replace("task_", "")
            
            # Get file modification time as timestamp (UTC)
            timestamp = datetime.fromtimestamp(state_file.stat().st_mtime, tz=timezone.utc).isoformat()
            
            status = state.get("status", "unknown")

            # Cleanup: if a task is marked running but there is no live PID, treat it as failed.
            if status == "running":
                pid = state.get("pid")
                if isinstance(pid, int):
                    if not pid_is_alive(pid):
                        status = "error"
                        state["status"] = "error"
                        state["message"] = state.get("message") or "Task was interrupted (process not running)"
                        write_task_state(task_id, state)
                else:
                    # Older state files may not include a PID; if the state file hasn't been updated
                    # recently, assume it is stale.
                    age_s = max(0, int(datetime.now(timezone.utc).timestamp() - state_file.stat().st_mtime))
                    if age_s > 60:
                        status = "error"
                        state["status"] = "error"
                        state["message"] = state.get("message") or "Task was interrupted (stale running state)"
                        write_task_state(task_id, state)

            jobs.append({
                "task_id": task_id,
                "filename": state.get("filename", ""),
                "original_filename": state.get("original_filename", ""),
                "timestamp": state.get("timestamp", timestamp),
                "runtime": state.get("runtime"),
                "status": status,
                "result_dir": state.get("result_dir", ""),
                "progress": state.get("progress", 0),
            })
        except Exception as e:
            print(f"Error reading state file {state_file}: {e}")
            continue
    
    return {"status": "success", "jobs": jobs}


@app.post("/api/cancel/{task_id}")
async def cancel_task(task_id: str):
    """Cancel a running OCR task"""
    state = read_task_state(task_id)
    if not state:
        return {"status": "error", "message": "Task does not exist"}
    
    if state.get("status") != "running":
        return {"status": "error", "message": f"Task is not running (status: {state.get('status')})"}
    
    # Try to cancel the task
    success = cancel_ocr_task(task_id)
    
    if success:
        return {"status": "success", "message": f"Task {task_id} cancelled"}
    else:
        # If the task hasn't spawned a subprocess yet (or the process is no longer
        # tracked), mark it cancelled in state so the UI can recover cleanly.
        state = read_task_state(task_id) or {}
        if state.get("status") == "running":
            state["status"] = "cancelled"
            state["message"] = "Task cancellation requested"
            write_task_state(task_id, state)
            return {"status": "success", "message": f"Task {task_id} cancelled"}

        return {"status": "error", "message": "Failed to cancel task"}


@app.delete("/api/delete/{task_id}")
async def delete_task(task_id: str):
    """Delete a task and its result files"""
    import shutil
    
    state = read_task_state(task_id)
    if not state:
        return {"status": "error", "message": "Task does not exist"}
    
    # Don't allow deleting running tasks
    if state.get("status") == "running":
        return {"status": "error", "message": "Cannot delete a running task. Cancel it first."}
    
    try:
        # Delete result directory if it exists
        result_dir = state.get("result_dir")
        if result_dir:
            result_path = Path(result_dir)
            if result_path.exists():
                shutil.rmtree(result_path)
                print(f"🗑️ Deleted result directory: {result_path}")
        
        # Delete task state file
        state_file = LOGS_DIR / f"task_{task_id}.json"
        if state_file.exists():
            state_file.unlink()
            print(f"🗑️ Deleted task state file: {state_file}")
        
        return {"status": "success", "message": f"Task {task_id} deleted"}
    except Exception as e:
        print(f"❌ Error deleting task {task_id}: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/api/download/zip/{task_id}")
async def download_zip(task_id: str, format: str = Query("mmd", description="Output format: mmd, md, or txt")):
    """Download all result files as a ZIP archive with format conversion"""
    state = read_task_state(task_id)
    if not state:
        return {"status": "error", "message": "Task does not exist"}
    
    if state.get("status") != "finished":
        return {"status": "error", "message": "Task is not finished"}
    
    result_dir = Path(state["result_dir"])
    if not result_dir.exists():
        return {"status": "error", "message": "Result directory does not exist"}
    
    # Validate format
    if format not in ["mmd", "md", "txt"]:
        format = "mmd"
    
    # Create ZIP in memory
    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for file_path in result_dir.rglob("*"):
            if file_path.is_file():
                # Get relative path
                rel_path = file_path.relative_to(result_dir)
                
                # Convert .mmd files to requested format
                if file_path.suffix.lower() == ".mmd" and format != "mmd":
                    # Read content
                    content = file_path.read_text(encoding="utf-8", errors="ignore")
                    
                    # Change extension
                    new_name = str(rel_path).replace(".mmd", f".{format}")
                    
                    # Write to zip with new name
                    zip_file.writestr(new_name, content)
                else:
                    # Add file as-is
                    zip_file.write(file_path, rel_path)
    
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=ocr_results_{task_id}.zip"
        }
    )


app.mount("/results", StaticFiles(directory=str(RESULTS_DIR)), name="results")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
