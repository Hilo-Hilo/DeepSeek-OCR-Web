# Dockerfile for DeepSeek-OCR-Web
# Uses NVIDIA PyTorch container as base (has CUDA-enabled PyTorch pre-installed)
#
# Build: docker build --network=host -t deepseek-ocr-web .
# Run:   docker run --gpus all -p 8002:8002 -p 3000:3000 -v ./deepseek-ocr:/app/deepseek-ocr:ro deepseek-ocr-web

# NVIDIA PyTorch container with CUDA support (works on ARM64)
FROM nvcr.io/nvidia/pytorch:24.08-py3

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTORCH_JIT=0

# CUDA environment (from start.sh)
ENV CUDA_HOME=/usr/local/cuda
ENV LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
ENV PATH=/usr/local/cuda/bin:$PATH

# Verify PyTorch CUDA is available
RUN python -c "import torch; print(f'PyTorch {torch.__version__}, CUDA: {torch.cuda.is_available()}')"

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Create working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# CRITICAL: Fix version compatibility for NVIDIA PyTorch container
# 1. Downgrade numpy to 1.x (container's PyTorch was built with NumPy 1.x)
# 2. Pin transformers to 4.45.0 (compatible with DeepSeek-OCR model)
RUN pip install "numpy<2" "transformers==4.45.0" --force-reinstall

# Install flash-attn (optional)
RUN pip install flash-attn --no-build-isolation || echo "flash-attn installation failed (non-critical)"

# Install frontend dependencies
COPY frontend/package*.json /app/frontend/
RUN cd /app/frontend && npm install --legacy-peer-deps

# Copy application code
COPY . /app/

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
