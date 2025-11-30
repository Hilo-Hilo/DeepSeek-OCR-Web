# Docker Deployment Guide

Complete guide for running DeepSeek-OCR-Web in Docker with GPU support.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Auto-Start on Boot](#auto-start-on-boot)
- [Remote Access (Tailscale VPN)](#remote-access-tailscale-vpn)
- [Development Mode](#development-mode)
- [Configuration](#configuration)
- [Image Size Breakdown](#image-size-breakdown)
- [Troubleshooting](#troubleshooting)
- [Container Management](#container-management)

---

## Prerequisites

### 1. Install NVIDIA Container Toolkit

The NVIDIA Container Toolkit enables Docker containers to access GPU resources.

**Ubuntu/Debian:**
```bash
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Verify installation:**
```bash
docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi
```

### 2. System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| GPU VRAM | 7 GB | 16-24 GB |
| Disk Space | 20 GB | 25 GB |
| Docker | 20.10+ | Latest |
| NVIDIA Driver | CUDA 12.x compatible | Latest |

### 3. Host System Requirements

**Must keep on host:**
- NVIDIA GPU Driver
- NVIDIA Container Toolkit
- Docker

**Can be removed from host (container has its own):**
- CUDA Toolkit
- cuDNN
- Python/Conda environments

---

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# 1. Download model weights (if not present)
pip install modelscope
mkdir -p ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr

# 2. Build and run
docker compose build
docker compose up -d

# 3. Access
# Frontend: http://localhost:3001
# Backend:  http://localhost:8002
```

### Option 2: Docker CLI

```bash
# Build (use --network=host for DNS issues)
docker build --network=host -t deepseek-ocr-web .

# Run
docker run -d --gpus all \
  -p 8002:8002 -p 3001:3000 \
  -v $(pwd)/deepseek-ocr:/app/deepseek-ocr:ro \
  -v $(pwd)/workspace:/app/workspace \
  -e MODEL_PATH=/app/deepseek-ocr \
  -e PYTORCH_JIT=0 \
  --restart unless-stopped \
  --name deepseek-ocr-web \
  deepseek-ocr-web
```

---

## Auto-Start on Boot

To automatically start DeepSeek-OCR-Web when your system boots, use the included systemd service.

### Install the Service

```bash
# Copy service file to systemd
sudo cp /home/hansonwen/DeepSeek-OCR-Web/deepseek-ocr.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload

# Enable auto-start on boot
sudo systemctl enable deepseek-ocr.service

# Start the service now
sudo systemctl start deepseek-ocr.service
```

### Service Management

```bash
# Check status
sudo systemctl status deepseek-ocr.service

# View logs
sudo journalctl -u deepseek-ocr.service -f

# Stop the service
sudo systemctl stop deepseek-ocr.service

# Disable auto-start
sudo systemctl disable deepseek-ocr.service
```

### What the Service Does

- **Starts after**: Docker service and network are ready
- **Container restart**: Uses `restart: unless-stopped` policy
- **Graceful shutdown**: Properly stops container on system shutdown

---

## Remote Access (Tailscale VPN)

Access DeepSeek-OCR-Web from any device on your Tailscale network.

### Fixed Ports

| Service | Port | URL |
|---------|------|-----|
| Frontend | 3001 | `http://<tailscale-ip>:3001` |
| Backend API | 8002 | `http://<tailscale-ip>:8002` |

### Example Access

If your Tailscale IP is `100.111.126.23`:
- **Frontend**: http://100.111.126.23:3001
- **API**: http://100.111.126.23:8002

### Verify Remote Access

```bash
# Check Tailscale IP
tailscale ip -4

# Test from remote device
curl http://100.111.126.23:8002/api/history
```

### Firewall (if needed)

If you have UFW or another firewall:
```bash
sudo ufw allow 3001/tcp
sudo ufw allow 8002/tcp
```

---

## Development Mode

For active development with **live code reloading** (no rebuild needed for code changes).

### Using Development Compose File

```bash
# Stop production container
docker stop deepseek-ocr-web

# Start development mode
docker compose -f docker-compose.dev.yml up
```

### What Reloads Automatically

| Change | Live Reload? | Mechanism |
|--------|--------------|-----------|
| `backend/*.py` | ✅ Instant | uvicorn --reload |
| `frontend/src/*` | ✅ Instant | Vite HMR |
| `workspace/*` | ✅ Always | Volume mount |
| `requirements.txt` | ❌ Rebuild | New dependencies |
| `package.json` | ❌ Rebuild | New dependencies |

### Rebuild Times (with caching)

| Change Type | Time | Notes |
|-------------|------|-------|
| Code only | ~2-3 min | Dependencies cached |
| Python deps | ~5-10 min | Pip install |
| Full rebuild | ~15-20 min | No cache |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `/app/deepseek-ocr` | Path to model weights |
| `CUDA_VISIBLE_DEVICES` | `0` | GPU device ID |
| `PYTORCH_JIT` | `0` | Disable JIT compilation |

### Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `./deepseek-ocr` | `/app/deepseek-ocr` | Model weights (read-only) |
| `./workspace` | `/app/workspace` | Uploads, results, logs |

### Data Persistence

All user data is stored in the `workspace/` directory on your host:

```
workspace/
├── uploads/    # Original uploaded files
├── results/    # OCR output (markdown, images)
└── logs/       # Job history and status
```

**Data persists across container restarts and rebuilds.**

---

## Image Size Breakdown

The Docker image is ~17 GB. Here's what takes up space:

| Component | Size | Description |
|-----------|------|-------------|
| NVIDIA PyTorch Base | ~15 GB | CUDA, cuDNN, PyTorch, TensorRT |
| Python Dependencies | ~320 MB | transformers, accelerate, etc. |
| Node.js + npm | ~400 MB | Frontend dependencies |
| Application Code | ~260 MB | Backend + frontend source |

**Model weights (4 GB) are NOT in the image** - they're mounted externally.

### Why So Large?

The base image (`nvcr.io/nvidia/pytorch:24.08-py3`) includes:
- Full CUDA toolkit (~3 GB)
- PyTorch with CUDA (~2.5 GB)
- cuDNN, NCCL, TensorRT (~5 GB)
- Various NVIDIA libraries (~4 GB)

### Version Compatibility

The following versions are pinned for compatibility:
- **numpy < 2.0**: NVIDIA container's PyTorch requires NumPy 1.x
- **transformers == 4.45.0**: Compatible with DeepSeek-OCR model

These are automatically handled in the Dockerfile.

---

## Troubleshooting

### DNS Issues (Berkeley WiFi, etc.)

```bash
# Build with host networking
docker build --network=host -t deepseek-ocr-web .

# Or configure Docker DNS
echo '{"dns": ["8.8.8.8", "8.8.4.4"]}' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

### GPU Not Detected

```bash
# 1. Verify NVIDIA Container Toolkit
docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu22.04 nvidia-smi

# 2. Check Docker runtime
docker info | grep -i runtime

# 3. Restart Docker
sudo systemctl restart docker
```

### Port Conflicts

```bash
# Use different host ports
docker run -p 8003:8002 -p 3001:3000 ...

# Find what's using a port
lsof -i :8002
```

### CUDA Compatibility Warnings

Warnings about CUDA capabilities (e.g., sm_121 for Blackwell GPUs) are expected. The inference code handles these via:
- `PYTORCH_JIT=0` environment variable
- `torch._dynamo.config.suppress_errors = True` in inference scripts

### Build Failures

- Ensure sufficient disk space (~20 GB)
- Use `--network=host` for DNS issues
- Check detailed logs: `docker compose build --progress=plain`

---

## Container Management

### Basic Commands

```bash
# View logs
docker logs -f deepseek-ocr-web

# Stop container
docker stop deepseek-ocr-web

# Start existing container
docker start deepseek-ocr-web

# Remove container
docker rm deepseek-ocr-web

# Rebuild
docker compose build --no-cache
```

### Cleanup

```bash
# Remove dangling images
docker image prune -f

# Remove build cache (frees lots of space)
docker builder prune -a -f

# Full cleanup (careful!)
docker system prune -a -f
```

### Check Resource Usage

```bash
# Disk usage
docker system df

# Container stats
docker stats deepseek-ocr-web
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `Dockerfile` | Main Docker image definition |
| `docker-compose.yml` | Production deployment |
| `docker-compose.dev.yml` | Development with live reload |
| `docker-entrypoint.sh` | Container startup script |
| `.dockerignore` | Files excluded from build |
