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
from datetime import datetime
from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi import Query

from file_manager import save_uploaded_file
from inference_runner import run_ocr_task, read_task_state, LOGS_DIR
from config_loader import UPLOAD_DIR, RESULTS_DIR


app = FastAPI(title="DeepSeek OCR Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
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

    async def background_task():
        def on_progress(p):
            if task_id in active_connections:
                ws = active_connections[task_id]
                asyncio.create_task(send_progress(ws, task_id, p))

        def on_console_log(msg):
            if task_id in console_connections:
                asyncio.create_task(send_console_log(task_id, msg))

        result = run_ocr_task(
            input_path=file_path, 
            task_id=task_id, 
            on_progress=on_progress, 
            prompt=prompt,
            filename=filename,
            original_filename=original_filename,
            on_console_log=on_console_log
        )

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

    return {
        "status": "success",
        "task_id": task_id,
        "state": status,
        "progress": progress
    }


@app.get("/api/file/content")
async def preview_file(path: str):
    """File preview"""
    file_path = Path(path)
    if not file_path.exists():
        return {"status": "error", "message": "File does not exist"}

    if file_path.suffix.lower() in [".png", ".jpg", ".jpeg"]:
        return FileResponse(file_path)
    else:
        content = file_path.read_text(encoding="utf-8", errors="ignore")
        return JSONResponse({"content": content})


@app.get("/api/history")
async def get_job_history():
    """Get all completed job history"""
    jobs = []
    
    if not LOGS_DIR.exists():
        return {"status": "success", "jobs": []}
    
    # Read all task state files
    for state_file in sorted(LOGS_DIR.glob("task_*.json"), reverse=True):
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
            
            # Extract task_id from filename
            task_id = state_file.stem.replace("task_", "")
            
            # Get file modification time as timestamp
            timestamp = datetime.fromtimestamp(state_file.stat().st_mtime).isoformat()
            
            jobs.append({
                "task_id": task_id,
                "filename": state.get("filename", ""),
                "original_filename": state.get("original_filename", ""),
                "timestamp": state.get("timestamp", timestamp),
                "runtime": state.get("runtime"),
                "status": state.get("status", "unknown"),
                "result_dir": state.get("result_dir", ""),
            })
        except Exception as e:
            print(f"Error reading state file {state_file}: {e}")
            continue
    
    return {"status": "success", "jobs": jobs}


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
