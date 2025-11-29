# System Changes Documentation

This document records all system-level changes made to support DeepSeek-OCR-Web on an NVIDIA GB10 (Blackwell) ARM64 system.

## System Information

- **Architecture**: AArch64 (ARM64)
- **OS**: Ubuntu (Linux 6.11.0-1016-nvidia)
- **GPU**: NVIDIA GB10 (Blackwell, sm_121 / CUDA Capability 12.1)
- **Original CUDA**: 13.0 (pre-installed)

---

## 1. Miniconda Installation

**Location**: `~/miniconda3/`

**What was installed**:
```bash
wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh -O miniconda.sh
bash miniconda.sh -b -p $HOME/miniconda3
rm miniconda.sh
```

**Conda Terms of Service accepted for**:
- https://repo.anaconda.com/pkgs/main
- https://repo.anaconda.com/pkgs/r

**Shell initialization**:
```bash
~/miniconda3/bin/conda init bash
```
This modified `~/.bashrc` to include Conda initialization.

**To remove**:
```bash
rm -rf ~/miniconda3
# Remove conda init block from ~/.bashrc
```

---

## 2. CUDA 12.6 Toolkit Installation

**Command**:
```bash
sudo apt install cuda-toolkit-12-6
```

**Location**: `/usr/local/cuda-12.6/`

**Purpose**: PyTorch nightly requires CUDA 12.x libraries. The system came with CUDA 13.0, but PyTorch doesn't support CUDA 13 yet.

**To remove**:
```bash
sudo apt remove cuda-toolkit-12-6
```

---

## 3. CUDA Support Libraries

The following libraries were installed to support PyTorch and deep learning operations:

### cuDNN (Deep Neural Network Library)
```bash
sudo apt install libcudnn9-cuda-12 libcudnn9-dev-cuda-12
```
**Location**: `/usr/lib/aarch64-linux-gnu/libcudnn*`

### cuSPARSELt (Sparse Matrix Library)
```bash
sudo apt install libcusparselt0-cuda-12
```
**Location**: `/usr/lib/aarch64-linux-gnu/libcusparseLt/12/`

### NCCL (Multi-GPU Communication)
```bash
sudo apt install libnccl2 libnccl-dev
```
**Location**: `/usr/lib/aarch64-linux-gnu/libnccl*`

### NVSHMEM (Shared Memory Library)
```bash
sudo apt install libnvshmem3-cuda-12
```
**Location**: `/usr/lib/aarch64-linux-gnu/nvshmem/12/`

**To remove all**:
```bash
sudo apt remove libcudnn9-cuda-12 libcudnn9-dev-cuda-12 \
                libcusparselt0-cuda-12 \
                libnccl2 libnccl-dev \
                libnvshmem3-cuda-12
```

---

## 4. Conda Environment: `deepseek-ocr`

**Created by**: `install.sh`

**Contains**:
- Python 3.12
- Node.js 22 (from conda-forge)
- PyTorch Nightly (cu128) - supports sm_120, compatible with sm_121
- Hugging Face Transformers
- Other Python dependencies

**Key packages**:
```bash
conda activate deepseek-ocr
pip list | grep -E "torch|transformers|accelerate"
```

**To remove**:
```bash
conda env remove -n deepseek-ocr
```

---

## 5. Removed/Cleaned Up Items

### Symlink Workarounds (Removed)
A temporary directory `~/cuda-compat/` was created with symlinks to fake CUDA 12 libraries using CUDA 13. This has been **removed** after installing CUDA 12.6:
```bash
rm -rf ~/cuda-compat
```

### System Symlink (Removed)
A symlink was temporarily created at `/usr/local/cuda/lib64/libcudart.so.12`. This has been **removed**:
```bash
sudo rm /usr/local/cuda/lib64/libcudart.so.12
```

---

## 6. Code Changes Made

### Backend Changes (vLLM → Hugging Face Transformers)

The original DeepSeek-OCR-Web used vLLM for inference, which is incompatible with the Blackwell GPU. The backend was refactored to use Hugging Face Transformers instead.

**New files created**:
- `backend/run_dpsk_ocr_pdf_hf.py` - PDF OCR using HF Transformers
- `backend/run_dpsk_ocr_image_hf.py` - Image OCR using HF Transformers

**Modified files**:
- `backend/inference_runner.py` - Updated to use HF scripts
- `backend/deepencoder/clip_sdpa.py` - Made `flash_attn` import optional
- `backend/deepencoder/sam_vary_sdpa.py` - Made `flash_attn` import optional
- `backend/process/image_process.py` - Removed `ProcessorMixin` inheritance (caused ARM64 crash)

**Key implementation**:
Uses the official `model.infer()` method from DeepSeek-OCR:
```python
from transformers import AutoModel, AutoTokenizer

tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
model = AutoModel.from_pretrained(MODEL_PATH, trust_remote_code=True, use_safetensors=True)
model = model.eval().cuda().to(torch.bfloat16)

result = model.infer(
    tokenizer,
    prompt="<image>\n<|grounding|>Convert the document to markdown.",
    image_file="path/to/image.jpg",
    output_path="output/dir",
    base_size=1024,
    image_size=640,
    crop_mode=True,
    save_results=True
)
```

### Environment Variables

Set in `start.sh`:
```bash
export LD_LIBRARY_PATH="/usr/local/cuda-12.6/lib64:/usr/lib/aarch64-linux-gnu/nvshmem/12:$LD_LIBRARY_PATH"
export PYTORCH_JIT=0  # Disable JIT compilation for Blackwell compatibility
```

---

## 7. Summary of Installed Packages

| Package | Purpose | Location |
|---------|---------|----------|
| Miniconda | Python environment manager | `~/miniconda3/` |
| cuda-toolkit-12-6 | CUDA 12.6 toolkit | `/usr/local/cuda-12.6/` |
| libcudnn9-cuda-12 | Deep learning primitives | `/usr/lib/aarch64-linux-gnu/` |
| libcusparselt0-cuda-12 | Sparse matrix ops | `/usr/lib/aarch64-linux-gnu/libcusparseLt/12/` |
| libnccl2 | Multi-GPU communication | `/usr/lib/aarch64-linux-gnu/` |
| libnvshmem3-cuda-12 | GPU shared memory | `/usr/lib/aarch64-linux-gnu/nvshmem/12/` |

---

## 8. Performance Notes

### Current Performance
- **~12-17 seconds per page** for PDF OCR
- **GPU Utilization**: ~35-50% (limited by autoregressive token generation)
- **Memory Bandwidth**: 0% (not memory-bound)
- **Power Draw**: ~18W (GPU not working at full capacity)

### Bottleneck
The main bottleneck is **autoregressive token generation** - the model generates text one token at a time sequentially. This is a fundamental limitation of transformer-based language models, not the hardware.

### Potential Optimizations
| Optimization | Impact | Notes |
|--------------|--------|-------|
| Lower resolution (`base_size=512`) | Medium | Reduces vision tokens |
| Flash Attention | Medium | May help with attention computation |
| Quantization (INT8/INT4) | Medium | Reduces memory per token |
| vLLM (when compatible) | High | Continuous batching support |

---

## 9. Complete Removal Instructions

To completely remove all system changes:

```bash
# 1. Remove Miniconda and Conda environment
rm -rf ~/miniconda3
# Edit ~/.bashrc and remove the conda initialize block

# 2. Remove CUDA 12.6 and libraries
sudo apt remove cuda-toolkit-12-6 \
                libcudnn9-cuda-12 libcudnn9-dev-cuda-12 \
                libcusparselt0-cuda-12 \
                libnccl2 libnccl-dev \
                libnvshmem3-cuda-12

# 3. Clean up (optional)
sudo apt autoremove

# 4. Remove the project
rm -rf ~/DeepSeek-OCR-Web
```

---

## 10. Notes

- **CUDA 13.0 remains untouched** at `/usr/local/cuda-13.0/`
- The system default `/usr/local/cuda` symlink still points to CUDA 13
- Other applications using CUDA 13 will continue to work normally
- The CUDA 12 libraries coexist with CUDA 13 without conflict
- PyTorch nightly (cu128) supports sm_120, which is forward-compatible with sm_121 (Blackwell)

---

## 11. References

- [DeepSeek-OCR GitHub](https://github.com/deepseek-ai/DeepSeek-OCR)
- [DeepSeek-OCR Hugging Face](https://huggingface.co/deepseek-ai/DeepSeek-OCR)
- [PyTorch CUDA Compatibility](https://pytorch.org/get-started/locally/)
