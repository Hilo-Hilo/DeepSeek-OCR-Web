# docr

DeepSeek OCR CLI for the HTTP API.

## Install

```bash
pip install -e packages/cli
```

## Usage

```bash
# Convert files (fire-and-forget)
docr /path/to/doc.pdf

docr convert /path/to/a.pdf /path/to/b.png

# Check status
docr status <task_id>

# List recent jobs
docr list

# Stream logs
docr logs <task_id>

# Download result markdown
docr download <task_id> [--output /path/to/file.md]

# Cancel task
docr cancel <task_id>
```

## Config

Set `DGX_OCR_BASE_URL` to override the API base URL. Default: `http://100.111.126.23:8002`.
