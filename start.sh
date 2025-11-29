#!/bin/bash
###############################################################################
# DeepSeek-OCR Start Script (Generic/Conda Isolated)
# Supports: Python Backend (FastAPI) + Vite Frontend
# Requirement: Conda environment 'deepseek-ocr'
###############################################################################

set -e

# Colors
GREEN="\033[1;32m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
RESET="\033[0m"

echo -e "${GREEN}============================================================${RESET}"
echo -e "🚀 ${YELLOW}Starting DeepSeek-OCR Project...${RESET}"
echo -e "${GREEN}============================================================${RESET}"

# 1. Activate Environment
echo -e "${YELLOW}>>> Step 1. Activating Conda Environment${RESET}"

# Attempt to find conda
find_conda() {
    locations=(
        "$HOME/miniconda3/bin/conda"
        "$HOME/anaconda3/bin/conda"
        "/opt/conda/bin/conda"
        "/usr/local/bin/conda"
    )
    if command -v conda &> /dev/null; then echo "conda"; return; fi
    for loc in "${locations[@]}"; do if [ -x "$loc" ]; then echo "$loc"; return; fi; done
}

CONDA_EXE=$(find_conda)

if [ -n "$CONDA_EXE" ]; then
    # Initialize conda for this script execution
    eval "$($CONDA_EXE shell.bash hook)"
    
    if conda env list | grep -q "deepseek-ocr"; then
        conda activate deepseek-ocr
        echo -e "${GREEN}✅ Activated Conda environment: deepseek-ocr${RESET}"
    else
        echo -e "${RED}❌ Conda environment 'deepseek-ocr' not found.${RESET}"
        echo -e "${YELLOW}ℹ️  Please run 'bash install.sh' first.${RESET}"
        exit 1
    fi
else
    echo -e "${RED}❌ Conda not found.${RESET}"
    exit 1
fi

# Set CUDA 12.6 library paths (clean setup, no symlinks needed)
export LD_LIBRARY_PATH="/usr/local/cuda-12.6/lib64:/usr/lib/aarch64-linux-gnu/libcusparseLt/12:/usr/lib/aarch64-linux-gnu/nvshmem/12:$LD_LIBRARY_PATH"
export CUDA_HOME="/usr/local/cuda-12.6"
echo -e "${GREEN}✅ CUDA 12.6 paths configured${RESET}"

# 2. Start Backend
BACKEND_PORT=8002
if lsof -i:$BACKEND_PORT >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Backend port $BACKEND_PORT in use. Killing old process...${RESET}"
    fuser -k ${BACKEND_PORT}/tcp || true
fi

echo -e "${YELLOW}>>> Step 2. Starting Backend (Uvicorn)...${RESET}"
cd backend || cd .
nohup uvicorn main:app --host 0.0.0.0 --port ${BACKEND_PORT} --reload > ../backend.log 2>&1 &
BACK_PID=$!
echo -e "${GREEN}✅ Backend started (PID: $BACK_PID). Log: backend.log${RESET}"
cd ..

# 3. Start Frontend
FRONTEND_PORT=3000
if lsof -i:$FRONTEND_PORT >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Frontend port $FRONTEND_PORT in use. Killing old process...${RESET}"
    fuser -k ${FRONTEND_PORT}/tcp || true
fi

echo -e "${YELLOW}>>> Step 3. Starting Frontend (Vite)...${RESET}"
if [ -d "frontend" ]; then
    cd frontend
    # Use the npm from the activated conda environment
    nohup npm run dev -- --host > ../frontend.log 2>&1 &
    FRONT_PID=$!
    echo -e "${GREEN}✅ Frontend started (PID: $FRONT_PID). Log: frontend.log${RESET}"
    cd ..
else
    echo -e "${RED}❌ Frontend directory not found!${RESET}"
fi

# 4. Completion
echo -e "${GREEN}============================================================${RESET}"
echo -e "${GREEN}🎉 DeepSeek-OCR Started Successfully!${RESET}"
echo -e "🌐 Backend: ${YELLOW}http://127.0.0.1:${BACKEND_PORT}${RESET}"
echo -e "🖥️  Frontend: ${YELLOW}http://127.0.0.1:${FRONTEND_PORT}${RESET}"
echo -e "🧾 Backend Log: backend.log"
echo -e "🧾 Frontend Log: frontend.log"
echo -e "${GREEN}============================================================${RESET}"

wait
