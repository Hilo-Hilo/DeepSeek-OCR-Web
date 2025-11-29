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
- **Operating System**: Requires running on Linux system
- **GPU Requirements**: GPU ≥ 7 GB VRAM (16–24 GB recommended for large images/multi-page PDFs)
- **Compatibility Note**: RTX 50 series GPUs are currently not compatible, please use other GPU models
- **Python Version**: 3.10–3.12 (3.10/3.11 recommended)
- **CUDA Version**: 11.8 or 12.1/12.2 (must match GPU driver)
- **PyTorch**: Requires installing pre-compiled version matching CUDA

### Quick Start
#### Method 1: One-click Script Startup (Recommended)
This method automatically handles environment setup for various architectures (x86_64, AArch64/ARM64).

```bash
# Install Conda (if missing), create environment, and install dependencies
bash install.sh
# Start services
bash start.sh
```

#### Method 2: Manual Installation and Running

##### Step 1: Model Weight Download
First, you need to download the DeepSeek-OCR model weights, which can be obtained from **Hugging Face** or **ModelScope**. The following example uses **ModelScope**:

```bash
pip install modelscope
mkdir ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr
```

##### Step 2: Runtime Environment Setup
Download the official project package

```bash
git clone https://github.com/deepseek-ai/DeepSeek-OCR.git
```

Create a Conda environment with Python 3.12 and Node.js 22 (Isolated):

```bash
conda create -n deepseek-ocr -c conda-forge python=3.12 nodejs=22 -y
conda activate deepseek-ocr
```

Install PyTorch related components (Pip will resolve the correct version for your CUDA/CPU):

```bash
pip install torch torchvision torchaudio
```

Install vLLM (For ARM64 users, this may require building from source if wheels are unavailable):
```Bash
pip install vllm
```

Install project basic dependencies

```Bash
cd ./DeepSeek-OCR/
pip install -r requirements.txt
```

If dependency conflicts appear during installation as shown in the image, you can ignore them as they won't affect actual operation.

<img src="assets\3b6eecd322d1ac8aa411e53fd8eefc2f.png"/>

Install flash-attn acceleration library (Optional).

```Bash
pip install flash-attn --no-build-isolation
```

Create a `.env` file in the project root directory and enter the model runtime address, for example:
```
MODEL_PATH=/path/to/deepseek-ocr
```

##### Step 3: Start Backend Service

Start the backend
```bash
uvicorn main:app --host 0.0.0.0 --port 8002 --reload
```

##### Step 4: Start Frontend Service
Install frontend dependencies (using isolated npm)
```bash
cd frontend
npm install
```

Start the frontend
```bash
npm run dev
```

After successful startup, access the frontend address in your browser to use the tool.

## 🙈 Contributing
We welcome contributions to the project through GitHub PR submissions or issues. We very much welcome any form of contribution, including feature improvements, bug fixes, or documentation optimization.

## 😎 Technical Communication
Scan to add our assistant, reply "DeepSeekOCR" to join the technical communication group and exchange learning with other partners.

<div align="center">
<img src="assets\afe0e4d094987b00012c5129a38ade24.png" width="200" alt="Technical Communication Group QR Code">
<div>
