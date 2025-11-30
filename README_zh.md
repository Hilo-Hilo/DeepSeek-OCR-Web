<div align="center">
  <h1>DeepSeek-OCR 可视化系统</h1>
  <span>中文 | <a href="./README.md">English</a></span>
</div>

## ⚡ 项目简介

本项目是基于 DeepSeek-OCR 的多模态文档解析工具。采用 FastAPI 后端 + React 前端
![项目图片](assets/项目图片.png)
该工具能够高效地处理 PDF 文档和图片，提供强大的光学字符识别（OCR）功能，支持多语种文字识别、表格解析、图表分析等多种功能。

### 主要功能

- **多格式文档解析**：支持 PDF、图片等多种格式的文档上传和解析
- **智能 OCR 识别**：基于 DeepSeek-OCR 模型，提供高精度的文字识别
- **版面分析**：智能识别文档版面结构，准确提取内容布局
- **多语种支持**：支持中文、英文等多种语言的文字识别
- **表格&图表解析**：专业的表格识别和图表数据提取功能
- **专业领域图纸识别**：支持各类专业领域图纸的语义识别
- **数据可视化**：支持数据分析可视化图的逆向解析
- **Markdown 转换**：将 PDF 内容转换为结构化的 Markdown 格式

## 👀 项目演示

<div align="center">

**PDF文档解析 - 支持图片、表格等复杂内容**

<img src="assets/文档解析.gif" width="600" alt="文档解析">

</div>

<div align="center">

| 多语种文字解析 | 图表&表格解析 |
|:---:|:---:|
| <img src="assets/多语种.gif" width="400" alt="多语种文字解析"> | <img src="assets/表格解析.gif" width="400" alt="图表&表格解析"> |

</div>

<div align="center">

| 专业领域图纸语义识别（支持CAD、流程图、装饰图等） | 数据分析可视化图逆向解析 |
|:---:|:---:|
| <img src="assets/CAD图纸语义解析.gif" width="400" alt="CAD图纸语义识别"> | <img src="assets/图表逆向表格.gif" width="400" alt="数据可视化图逆向解析"> |

</div>

## 🚀 使用指南

### 系统要求

⚠️ **重要提示**：
- **操作系统**：Linux（推荐 Ubuntu）
- **显卡要求**：GPU ≥ 7 GB 显存（大图/多页 PDF 建议 16–24 GB）
- **兼容性说明**：RTX 50 系显卡需要特殊配置（见 SYSTEM_CHANGES.md）

### 快速开始

选择以下方法之一：

| 方法 | 适用场景 | 安装时间 |
|------|----------|----------|
| [Docker（推荐）](#方法一docker推荐) | 生产环境、快速部署 | ~10 分钟 |
| [脚本安装](#方法二脚本安装) | 开发环境、自定义配置 | ~20 分钟 |
| [手动安装](#方法三手动安装) | 完全控制 | ~30 分钟 |

---

### 方法一：Docker（推荐）

Docker 提供最简单的部署方式，所有依赖已预配置。

**前提条件：**
- Docker 20.10+
- NVIDIA Container Toolkit（[安装指南](./DOCKER.md#1-install-nvidia-container-toolkit)）
- ~20 GB 磁盘空间

**快速启动：**
```bash
# 1. 下载模型权重
pip install modelscope
mkdir -p ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr

# 2. 构建并运行（如遇 DNS 问题使用 --network=host）
docker build --network=host -t deepseek-ocr-web .
docker run -d --gpus all \
  -p 8002:8002 -p 3001:3000 \
  -v ./deepseek-ocr:/app/deepseek-ocr:ro \
  -v ./workspace:/app/workspace \
  --restart unless-stopped \
  --name deepseek-ocr-web \
  deepseek-ocr-web

# 3. 访问应用
# 前端: http://localhost:3001（或 http://<tailscale-ip>:3001）
# 后端: http://localhost:8002
```

详细 Docker 文档请参阅 **[DOCKER.md](./DOCKER.md)**。

---

### 方法二：脚本安装

一键安装脚本（需要 Conda）。

```bash
# 安装模型权重及环境依赖
bash install.sh

# 启动服务
bash start.sh
```

**访问地址：**
- 前端: http://localhost:3000
- 后端: http://localhost:8002

---

### 方法三：手动安装

#### 步骤 1：下载模型权重

```bash
pip install modelscope
mkdir ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr
```

#### 步骤 2：配置环境

```bash
# 创建 Conda 环境
conda create -n deepseek-ocr -c conda-forge python=3.12 nodejs=22 -y
conda activate deepseek-ocr

# 安装 PyTorch
pip install torch torchvision torchaudio

# 安装依赖
pip install -r requirements.txt

# 可选：安装 flash-attn 加速
pip install flash-attn --no-build-isolation
```

#### 步骤 3：配置环境变量

在项目根目录创建 `.env` 文件：
```
MODEL_PATH=/path/to/deepseek-ocr
```

#### 步骤 4：启动服务

```bash
# 终端 1：后端
cd backend
uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# 终端 2：前端
cd frontend
npm install
npm run dev
```

---

## 📁 文件位置

| 数据 | 位置 | 说明 |
|------|------|------|
| 上传文件 | `workspace/uploads/` | 原始 PDF 和图片 |
| OCR 结果 | `workspace/results/` | Markdown 输出、标注图片 |
| 任务历史 | `workspace/logs/` | 任务状态和元数据 |
| 模型权重 | `deepseek-ocr/` | DeepSeek-OCR 模型文件 |

---

## 📖 文档

- **[DOCKER.md](./DOCKER.md)** - Docker 部署指南、开发模式、故障排除
- **[SYSTEM_CHANGES.md](./SYSTEM_CHANGES.md)** - ARM64/Blackwell GPU 的系统级更改

---

## 🙈 贡献

欢迎通过 GitHub 提交 PR 或 issues 来对项目进行贡献。我们非常欢迎任何形式的贡献，包括功能改进、bug 修复或是文档优化。

## 😎 技术交流

扫描添加小可爱，回复"DeepSeekOCR"加入技术交流群，与其他小伙伴一起交流学习。

<div align="center">
<img src="assets/afe0e4d094987b00012c5129a38ade24.png" width="200" alt="技术交流群二维码">
</div>
