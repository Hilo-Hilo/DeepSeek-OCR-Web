# System Changes Documentation

This document records all system-level changes made to support DeepSeek-OCR-Web on an NVIDIA GB10 (Blackwell) ARM64 system.

## System Information

- **Architecture**: AArch64 (ARM64)
- **OS**: Ubuntu (Linux 6.11.0-1016-nvidia)
- **GPU**: NVIDIA GB10 (Blackwell, sm_121 / CUDA Capability 12.1)
- **Original CUDA**: 13.0 (pre-installed)

---

## Deployment Options

### Option 1: Docker (Recommended)

Docker deployment is self-contained and requires minimal host configuration.

**Host Requirements:**
- NVIDIA GPU Driver (keep this!)
- NVIDIA Container Toolkit
- Docker

**What Docker Provides (no host installation needed):**
- CUDA Toolkit
- cuDNN
- PyTorch with CUDA
- Python environment
- Node.js

See [DOCKER.md](./DOCKER.md) for complete Docker instructions.

### Option 2: Native Installation

Native installation requires the system changes documented below.

---

## Native Installation: System Changes

### 1. Miniconda Installation

**Location**: `~/miniconda3/`

**What was installed**:
```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh -O miniconda.sh
bash miniconda.sh -b -p $HOME/miniconda3
rm miniconda.sh
```

**Shell initialization** (modified `~/.bashrc`):
```bash
~/miniconda3/bin/conda init bash
```

**To remove**:
```bash
rm -rf ~/miniconda3
# Edit ~/.bashrc and remove the conda initialize block
```

---

### 2. CUDA 12.6 Toolkit Installation

**Note**: If using Docker, this is NOT needed on the host.

**Command**:
```bash
sudo apt install cuda-toolkit-12-6
```

**Location**: `/usr/local/cuda-12.6/`

**Purpose**: PyTorch requires CUDA 12.x libraries. The system came with CUDA 13.0, but PyTorch doesn't support CUDA 13 yet.

**To remove**:
```bash
sudo apt remove cuda-toolkit-12-6
sudo rm -rf /usr/local/cuda-12.6
```

---

### 3. CUDA Support Libraries

**Note**: If using Docker, these are NOT needed on the host.

#### cuDNN (Deep Neural Network Library)
```bash
sudo apt install libcudnn9-cuda-12 libcudnn9-dev-cuda-12
```

#### cuSPARSELt (Sparse Matrix Library)
```bash
sudo apt install libcusparselt0-cuda-12
```

#### NCCL (Multi-GPU Communication)
```bash
sudo apt install libnccl2 libnccl-dev
```

#### NVSHMEM (Shared Memory Library)
```bash
sudo apt install libnvshmem3-cuda-12
```

**To remove all**:
```bash
sudo apt remove libcudnn9-cuda-12 libcudnn9-dev-cuda-12 \
                libcusparselt0-cuda-12 \
                libnccl2 libnccl-dev \
                libnvshmem3-cuda-12
```

---

### 4. Conda Environment: `deepseek-ocr`

**Created by**: `install.sh`

**Contains**:
- Python 3.12
- Node.js 22 (from conda-forge)
- PyTorch (supports sm_120, compatible with sm_121)
- Hugging Face Transformers
- Other Python dependencies

**To remove**:
```bash
conda env remove -n deepseek-ocr
```

---

## Code Changes Made

### Backend Changes (vLLM → Hugging Face Transformers)

The original DeepSeek-OCR-Web used vLLM for inference, which is incompatible with the Blackwell GPU. The backend was refactored to use Hugging Face Transformers instead.

**New files created**:
- `backend/run_dpsk_ocr_pdf_hf.py` - PDF OCR using HF Transformers
- `backend/run_dpsk_ocr_image_hf.py` - Image OCR using HF Transformers

**Modified files**:
- `backend/inference_runner.py` - Updated to use HF scripts
- `backend/deepencoder/clip_sdpa.py` - Made `flash_attn` import optional
- `backend/deepencoder/sam_vary_sdpa.py` - Made `flash_attn` import optional
- `backend/process/image_process.py` - Removed `ProcessorMixin` inheritance

**Key implementation**:
```python
from transformers import AutoModel, AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, use_safetensors=True)
model = model.eval().cuda().to(torch.bfloat16)

result = model.infer(
    tokenizer,
    prompt="<image>\nFree OCR.",
    image_file="path/to/image.jpg",
    output_path="output/dir",
    base_size=1024,
    image_size=640,
    crop_mode=True,
    save_results=True
)
```

---

## Docker Setup

### Files Added for Docker Support

| File | Purpose |
|------|---------|
| `Dockerfile` | Main image definition using NVIDIA PyTorch base |
| `docker-compose.yml` | Production deployment configuration |
| `docker-compose.dev.yml` | Development mode with live reload |
| `docker-entrypoint.sh` | Container startup script |
| `.dockerignore` | Excludes model weights and workspace from build |
| `DOCKER.md` | Complete Docker documentation |

### Docker Image Details

- **Base Image**: `nvcr.io/nvidia/pytorch:24.08-py3`
- **Size**: ~17 GB (includes CUDA, PyTorch, cuDNN)
- **Python**: 3.10 (from base image)
- **Node.js**: 22 (installed in Dockerfile)

### Version Pins for Docker Compatibility

```dockerfile
# In Dockerfile - fixes compatibility issues
RUN pip install "numpy<2" "transformers==4.45.0" --force-reinstall
```

---

## Performance Notes

### Current Performance
- **~12-17 seconds per page** for PDF OCR (native)
- **~341 seconds** for complex images (Docker, first run loads model)
- **GPU Utilization**: ~35-50% (limited by autoregressive generation)

### Bottleneck
The main bottleneck is **autoregressive token generation** - the model generates text one token at a time sequentially. This is a fundamental limitation of transformer-based language models.

---

## Summary: What's Installed Where

### Native Installation

| Component | Location | Required? |
|-----------|----------|-----------|
| Miniconda | `~/miniconda3/` | Yes (for native) |
| CUDA 12.6 | `/usr/local/cuda-12.6/` | Yes (for native) |
| cuDNN, NCCL, etc. | `/usr/lib/aarch64-linux-gnu/` | Yes (for native) |
| Conda env | `deepseek-ocr` | Yes (for native) |

### Docker Installation

| Component | Location | Required on Host? |
|-----------|----------|-------------------|
| NVIDIA Driver | System | ✅ Yes |
| Container Toolkit | System | ✅ Yes |
| Docker | System | ✅ Yes |
| CUDA Toolkit | Container | ❌ No |
| Python/Node.js | Container | ❌ No |

---

## Complete Removal Instructions

### Remove Native Installation Only

```bash
# 1. Remove Miniconda
rm -rf ~/miniconda3
# Edit ~/.bashrc and remove conda initialize block

# 2. Remove CUDA 12.6 and libraries (optional - Docker doesn't need these)
sudo apt remove cuda-toolkit-12-6 \
                libcudnn9-cuda-12 libcudnn9-dev-cuda-12 \
                libcusparselt0-cuda-12 \
                libnccl2 libnccl-dev \
                libnvshmem3-cuda-12
sudo apt autoremove
```

### Remove Docker Setup

```bash
# Stop and remove container
docker stop deepseek-ocr-web
docker rm deepseek-ocr-web

# Remove image
docker rmi deepseek-ocr-web

# Clean build cache
docker builder prune -a -f
```

### Remove Everything

```bash
# Remove project
rm -rf ~/DeepSeek-OCR-Web

# Keep if using Docker for other projects:
# - NVIDIA Driver
# - NVIDIA Container Toolkit
# - Docker
```

---

## References

- [DeepSeek-OCR GitHub](https://github.com/deepseek-ai/DeepSeek-OCR)
- [DeepSeek-OCR Hugging Face](https://huggingface.co/deepseek-ai/DeepSeek-OCR)
- [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/)
- [PyTorch CUDA Compatibility](https://pytorch.org/get-started/locally/)
