# DGX OCR MCP Server

Standalone MCP server that wraps the DGX OCR backend at `http://100.111.126.23:8002` and exposes tools to convert PDFs/images to Markdown.

## Setup

```bash
cd mcp/dgx_ocr_mcp
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Optional: override backend URL.

```bash
export DGX_OCR_BASE_URL=http://100.111.126.23:8002
```

## Run the MCP server (stdio)

```bash
cd mcp/dgx_ocr_mcp
python -m dgx_ocr_mcp
```

## Tools

### convert_to_markdown
Inputs:
- `source_path` (local path on the MCP host) OR `source_url` (http/https)
- `prompt` (optional)
- `timeout_s` (optional)
- `wait` (optional, default false)
- `save_to_dir` (optional, directory to write markdown)
- `output_path` (optional, full path to write markdown)

Default behavior (`wait=false`):
- Starts the backend job synchronously (upload + `/api/start`) so you know it started successfully.
- Returns immediately with:
  - `job_id`
  - `status: "running"`
  - `task_id`
  - `saved_path`
- The MCP server continues in the background and **saves** markdown to `saved_path` when finished.

If `wait=true`:
- Blocks until finished (up to `timeout_s`, default 7200s) and returns full result including `markdown`.

Saving rules:
- `source_path` with no `save_to_dir`/`output_path` saves to `<same-dir>/<basename>.md`.
- `source_url` requires `save_to_dir` or `output_path`.

### get_job_status
Inputs:
- `job_id`

Returns:
- `job_id`
- `status`
- `task_id`
- `saved_path`
- `progress` (best-effort)
- `state` (best-effort)
- `error` (if any)

### get_job_result
Inputs:
- `job_id`

Returns:
- `job_id`
- `status`
- `result` (when finished)

### cancel_job
Inputs:
- `job_id`

Returns:
- `job_id`
- `status`
- `task_id`
- `cancel_response`

### list_recent_jobs
Inputs:
- `limit` (optional, default 10)

Returns:
- `jobs` (last N jobs from `/api/history`)

## Smoke test

Runs `convert_to_markdown` against a tiny **local** generated PDF (no external URL needed).

```bash
cd mcp/dgx_ocr_mcp
PYTHONPATH=. python -u scripts/smoke_test.py
```
