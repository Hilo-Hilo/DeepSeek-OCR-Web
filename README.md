<div align="center">
  <h1>DeepSeek-OCR Studio</h1>
  <span><a href="./README_zh.md">中文</a> | English</span>
</div>

## ⚡ Project Overview

This project is a multimodal document parsing tool based on DeepSeek-OCR with React frontend and FastAPI backend.
![项目图片](assets/项目图片.png)
This tool can efficiently process PDF documents and images, providing powerful Optical Character Recognition (OCR) capabilities, supporting multi-language text recognition, table parsing, chart analysis, and many other features.

### Key Features

- **Multi-format Document Parsing**: Supports uploading and parsing documents in various formats such as PDF and images
- **Intelligent OCR Recognition**: Based on the DeepSeek-OCR model, providing high-precision text recognition
- **Layout Analysis**: Intelligently recognizes document layout structure and accurately extracts content layout
- **Multi-language Support**: Supports text recognition in multiple languages including Chinese and English
- **Table & Chart Parsing**: Professional table recognition and chart data extraction functionality
- **Professional Domain Drawing Recognition**: Supports semantic recognition of various professional domain drawings
- **Data Visualization**: Supports reverse parsing of data analysis visualization charts
- **Markdown Conversion**: Converts PDF content to structured Markdown format

## 👀 Project Demo

<div align="center">

**PDF Document Parsing - Supports complex content including images and tables**

<img src="assets/文档解析.gif" width="600" alt="Document Parsing">

</div>

<div align="center">

| Multi-language Text Parsing | Chart & Table Parsing |
|:---:|:---:|
| <img src="assets/多语种.gif" width="400" alt="Multi-language Text Parsing"> | <img src="assets/表格解析.gif" width="400" alt="Chart & Table Parsing"> |

</div>

<div align="center">

| Professional Domain Drawing Recognition<br/>(CAD, Flowcharts, Decorative Drawings) | Data Visualization Chart<br/>Reverse Parsing |
|:---:|:---:|
| <img src="assets/CAD图纸语义解析.gif" width="400" alt="CAD Drawing Semantic Recognition"> | <img src="assets/图表逆向表格.gif" width="400" alt="Data Visualization Chart Reverse Parsing"> |

</div>

## 🚀 Usage Guide

### System Requirements

⚠️ **Important Notice**:
- **Operating System**: Linux (Ubuntu recommended)
- **GPU Requirements**: GPU ≥ 7 GB VRAM (16–24 GB recommended for large images/multi-page PDFs)
- **Compatibility Note**: RTX 50 series GPUs require special configuration (see SYSTEM_CHANGES.md)

### Quick Start

Choose one of the following methods:

| Method | Best For | Setup Time |
|--------|----------|------------|
| [Docker (Recommended)](#method-1-docker-recommended) | Production, Easy setup | ~10 min |
| [Native Script](#method-2-native-script) | Development, Custom setup | ~20 min |
| [Manual Installation](#method-3-manual-installation) | Full control | ~30 min |

---

### Method 1: Docker (Recommended)

Docker provides the easiest setup with all dependencies pre-configured.

**Prerequisites:**
- Docker 20.10+
- NVIDIA Container Toolkit ([installation guide](./DOCKER.md#1-install-nvidia-container-toolkit))
- ~20 GB disk space

**Quick Start:**
```bash
# 1. Download model weights
pip install modelscope
mkdir -p ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr

# 2. Build and run (use --network=host if you have DNS issues)
docker build --network=host -t deepseek-ocr-web .
docker run -d --gpus all \
  -p 8002:8002 -p 3001:3000 \
  -v ./deepseek-ocr:/app/deepseek-ocr:ro \
  -v ./workspace:/app/workspace \
  --restart unless-stopped \
  --name deepseek-ocr-web \
  deepseek-ocr-web

# 3. Access the application
# Frontend: http://localhost:3001 (or http://<tailscale-ip>:3001)
# Backend:  http://localhost:8002
```

For detailed Docker documentation including development mode, troubleshooting, and configuration options, see **[DOCKER.md](./DOCKER.md)**.

---

### Method 2: Native Script

One-click setup for native installation (requires Conda).

```bash
# Install dependencies and download model
bash install.sh

# Start services
bash start.sh
```

**Access:**
- Frontend: http://localhost:3000
- Backend: http://localhost:8002

---

### Method 3: Manual Installation

For full control over the installation process.

#### Step 1: Download Model Weights

```bash
pip install modelscope
mkdir ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr
```

#### Step 2: Setup Environment

```bash
# Create Conda environment
conda create -n deepseek-ocr -c conda-forge python=3.12 nodejs=22 -y
conda activate deepseek-ocr

# Install PyTorch
pip install torch torchvision torchaudio

# Install dependencies
pip install -r requirements.txt

# Optional: Install flash-attn for acceleration
pip install flash-attn --no-build-isolation
```

#### Step 3: Configure Environment

Create `.env` file in project root:
```
MODEL_PATH=/path/to/deepseek-ocr
```

#### Step 4: Start Services

```bash
# Terminal 1: Backend
cd backend
uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# Terminal 2: Frontend
cd frontend
npm install
npm run dev
```

---

## 📁 File Locations

| Data | Location | Description |
|------|----------|-------------|
| Uploaded Files | `workspace/uploads/` | Original PDFs and images |
| OCR Results | `workspace/results/` | Markdown output, annotated images |
| Job History | `workspace/logs/` | Task status and metadata |
| Model Weights | `deepseek-ocr/` | DeepSeek-OCR model files |

---

## 📖 Documentation

- **[DOCKER.md](./DOCKER.md)** - Docker deployment guide, development mode, troubleshooting
- **[SYSTEM_CHANGES.md](./SYSTEM_CHANGES.md)** - System-level changes for ARM64/Blackwell GPUs

---

## 🙈 Contributing

We welcome contributions through GitHub PR submissions or issues. All forms of contribution are appreciated, including feature improvements, bug fixes, or documentation optimization.

## 😎 Technical Communication

Scan to add our assistant, reply "DeepSeekOCR" to join the technical communication group.

<div align="center">
<img src="assets/afe0e4d094987b00012c5129a38ade24.png" width="200" alt="Technical Communication Group QR Code">
</div>
