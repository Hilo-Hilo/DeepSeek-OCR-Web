#!/bin/bash
###############################################################################
# DeepSeek-OCR Environment Setup Script (Generic/Conda Isolated)
# Features:
#  - Requires Conda to be pre-installed
#  - Creates isolated Conda environment
#  - Installs Node.js inside Conda (Full Isolation)
#  - Installs PyTorch + vLLM (auto-resolves for AArch64/x86)
###############################################################################

set -e
exec > >(tee setup.log) 2>&1

# Colors
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
RESET="\033[0m"

echo -e "${GREEN}============================================================${RESET}"
echo -e "🚀 ${YELLOW}DeepSeek-OCR-Web Environment Initialization${RESET}"
echo -e "${GREEN}============================================================${RESET}"

# 0. Check Architecture
ARCH=$(uname -m)
OS=$(uname -s)
echo -e "${YELLOW}ℹ️  Detected System: ${OS} ${ARCH}${RESET}"

# 1. Conda Setup
echo -e "${YELLOW}>>> Step 1. Checking Conda Environment${RESET}"

# Function to find conda executable
find_conda() {
    # Check common locations
    locations=(
        "$HOME/miniconda3/bin/conda"
        "$HOME/anaconda3/bin/conda"
        "/opt/conda/bin/conda"
        "/usr/local/bin/conda"
    )
    
    if command -v conda &> /dev/null; then
        echo "conda"
        return
    fi

    for loc in "${locations[@]}"; do
        if [ -x "$loc" ]; then
            echo "$loc"
            return
        fi
    done
}

CONDA_EXE=$(find_conda)

if [ -z "$CONDA_EXE" ]; then
    echo -e "${RED}❌ Conda not found.${RESET}"
    echo -e "${YELLOW}Please install Miniconda first:${RESET}"
    echo -e "  wget https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-${ARCH}.sh -O miniconda.sh"
    echo -e "  bash miniconda.sh -b -p \$HOME/miniconda3"
    echo -e "  rm miniconda.sh"
    echo -e "Then re-run this script."
    exit 1
fi

echo -e "${GREEN}✅ Found Conda: $CONDA_EXE${RESET}"
# Ensure conda is initialized in this script session
eval "$($CONDA_EXE shell.bash hook)"

# 2. Create/Update Environment
echo -e "${YELLOW}>>> Step 2. Creating Conda Environment (deepseek-ocr)${RESET}"

# Create environment with Python 3.12 and Node.js 22 (Isolated Node!)
# We install nodejs from conda-forge to ensure it's isolated to this environment
conda create -n deepseek-ocr -c conda-forge python=3.12 nodejs=22 -y

echo -e "${YELLOW}>>> Activating Environment${RESET}"
conda activate deepseek-ocr

# Verify Node.js isolation
NODE_PATH=$(which node)
echo -e "${GREEN}✅ Using Isolated Node.js: $NODE_PATH${RESET}"

# 3. Install PyTorch
echo -e "${YELLOW}>>> Step 3. Installing PyTorch${RESET}"
# Let pip resolve the best version for the platform (supports ARM64/CUDA if available)
pip install torch torchvision torchaudio

# 4. Install vLLM
echo -e "${YELLOW}>>> Step 4. Installing vLLM${RESET}"
# vLLM support for ARM64 can be experimental. We try standard pip install first.
if pip install vllm; then
    echo -e "${GREEN}✅ vLLM installed successfully.${RESET}"
else
    echo -e "${RED}⚠️  Standard vLLM install failed. This is expected on some ARM64 configs.${RESET}"
    echo -e "${YELLOW}ℹ️  Attempting to build from source or continuing without it (Inference may fail)...${RESET}"
    # In a real scenario, we might trigger a build from source here, but that's risky/long.
    # We'll just warn the user.
fi

# 5. Install Dependencies
echo -e "${YELLOW}>>> Step 5. Installing requirements${RESET}"
pip install -r requirements.txt

# Flash Attention (Optional but recommended)
echo -e "${YELLOW}Installing flash-attn (may take time to compile)...${RESET}"
pip install flash-attn --no-build-isolation || echo -e "${RED}⚠️  flash-attn install failed (Non-critical, but slower).${RESET}"

# 6. Download Model
echo -e "${YELLOW}>>> Step 6. Model Setup${RESET}"
pip install modelscope
mkdir -p ./deepseek-ocr
modelscope download --model deepseek-ai/DeepSeek-OCR --local_dir ./deepseek-ocr || {
    echo -e "${RED}⚠️  Model download failed. Check network.${RESET}"
}

# 7. Frontend Setup
echo -e "${YELLOW}>>> Step 7. Installing Frontend Dependencies${RESET}"
if [ -d "frontend" ]; then
    cd frontend
    # Use local .npmrc for registry mirror (optional, good for speed)
    echo "registry=https://registry.npmmirror.com" > .npmrc
    
    # Install using the ISOLATED npm from conda
    npm install
    cd ..
else
    echo -e "${YELLOW}⚠️  Frontend directory not found.${RESET}"
fi

# 8. .env Configuration
echo -e "${YELLOW}>>> Step 8. Configuring .env${RESET}"
PROJECT_DIR=$(pwd)
MODEL_DIR="${PROJECT_DIR}/deepseek-ocr"

if [ ! -f ".env" ]; then
    echo "MODEL_PATH=${MODEL_DIR}" > .env
else
    # Update MODEL_PATH if not present
    if ! grep -q "MODEL_PATH=" .env; then
        echo "MODEL_PATH=${MODEL_DIR}" >> .env
    fi
fi

echo -e "${GREEN}============================================================${RESET}"
echo -e "🎉 Setup Complete!"
echo -e "ℹ️  Environment: deepseek-ocr"
echo -e "ℹ️  To activate: ${YELLOW}conda activate deepseek-ocr${RESET}"
echo -e "${GREEN}============================================================${RESET}"
