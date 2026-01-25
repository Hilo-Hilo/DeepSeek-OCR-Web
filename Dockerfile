# Dockerfile for DeepSeek-OCR-Web
# Uses NVIDIA PyTorch container as base (has CUDA-enabled PyTorch pre-installed)
#
# Build: docker build --network=host -t deepseek-ocr-web .
# Run:   docker run --gpus all -p 8002:8002 -p 3001:3000 -v ./deepseek-ocr:/app/deepseek-ocr:ro deepseek-ocr-web

# NVIDIA PyTorch container with CUDA support (works on ARM64)
FROM nvcr.io/nvidia/pytorch:24.08-py3

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTORCH_JIT=0

# CUDA environment (from start.sh)
ENV CUDA_HOME=/usr/local/cuda
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
ENV PATH=/usr/local/cuda/bin:$PATH

# Print base image PyTorch build info (CUDA availability is runtime-dependent)
RUN python -c "import torch; print(f'Base image PyTorch: {torch.__version__} (built CUDA: {torch.version.cuda})')"

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# PyTorch for GB10 / Blackwell-family GPUs
# Use official CUDA 13.0 (cu130) wheels. On GB10 (sm_121) these wheels typically ship
# sm_120 + compute_120 PTX, so PyTorch may warn about supported capability, but CUDA
# ops can still work.
RUN pip install --no-cache-dir --upgrade \
    torch==2.10.0+cu130 torchvision==0.25.0+cu130 torchaudio==2.10.0+cu130 \
    --index-url https://download.pytorch.org/whl/cu130

# flash-attn is optional, but when upgrading PyTorch (e.g. to nightly cu128),
# any prebuilt flash-attn binaries can become ABI-incompatible and break model
# imports. Keep it uninstalled in Docker for stability.
RUN pip uninstall -y flash-attn || true

# Install frontend dependencies
COPY frontend/package*.json /app/frontend/
RUN cd /app/frontend && npm install --legacy-peer-deps

# Copy application code
COPY . /app/

# Build Next.js frontend for production (required for `next start`)
RUN cd /app/frontend && npm run build

# Create workspace directories
RUN mkdir -p /app/workspace/uploads /app/workspace/results /app/workspace/logs

# Set environment variables
ENV MODEL_PATH=/app/deepseek-ocr
ENV CUDA_VISIBLE_DEVICES=0

# Expose ports
EXPOSE 8002 3000

# Make entrypoint executable
RUN chmod +x /app/docker-entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8002/api/history || exit 1

# Default entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
