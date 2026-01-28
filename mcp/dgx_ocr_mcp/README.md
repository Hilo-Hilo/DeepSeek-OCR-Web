# DGX OCR MCP Server

Standalone MCP server that wraps the DGX OCR backend at `http://100.111.126.23:8002` and exposes tools to convert PDFs/images to Markdown.

## Setup

```bash
cd mcp/dgx_ocr_mcp
python -m venv .venv
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

Returns:
- `markdown`
- `task_id`
- `files`
- `result_dir`
- `selected_file`

### list_recent_jobs
Inputs:
- `limit` (optional, default 10)

Returns:
- `jobs` (last N jobs from `/api/history`)

## Smoke test

Runs `convert_to_markdown` against a tiny sample PDF fetched from the web.

```bash
cd mcp/dgx_ocr_mcp
PYTHONPATH=. python scripts/smoke_test.py
```
