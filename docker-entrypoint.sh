#!/bin/bash
set -e

echo "============================================"
echo "🚀 DeepSeek-OCR-Web Docker Container"
echo "============================================"

# Function to handle shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo "✅ Services stopped"
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup SIGTERM SIGINT SIGQUIT

# Check GPU availability
echo "🔍 Checking GPU availability..."
if command -v nvidia-smi &> /dev/null; then
    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || echo "⚠️  GPU info unavailable"
else
    echo "⚠️  nvidia-smi not found"
fi

# Check model directory
echo "🔍 Checking model directory..."
if [ -d "/app/deepseek-ocr" ] && [ -f "/app/deepseek-ocr/config.json" ]; then
    echo "✅ Model directory found: /app/deepseek-ocr"
else
    echo "⚠️  Model directory not found or incomplete!"
    echo "   Please mount your model directory:"
    echo "   docker run -v /path/to/deepseek-ocr:/app/deepseek-ocr:ro ..."
fi

# Create workspace directories if they don't exist
mkdir -p /app/workspace/uploads /app/workspace/results /app/workspace/logs

# Start backend
echo ""
echo "🌐 Starting backend server on port 8002..."
cd /app/backend
python -m uvicorn main:app --host 0.0.0.0 --port 8002 &
BACKEND_PID=$!
echo "✅ Backend started (PID: $BACKEND_PID)"

# Wait a moment for backend to initialize
sleep 2

# Start frontend
echo ""
echo "🖥️  Starting frontend server on port 3000..."
cd /app/frontend
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!
echo "✅ Frontend started (PID: $FRONTEND_PID)"

echo ""
echo "============================================"
echo "🎉 DeepSeek-OCR-Web is running!"
echo "   Backend:  http://localhost:8002"
echo "   Frontend: http://localhost:3000"
echo "============================================"
echo ""

# Wait for any process to exit
wait -n $BACKEND_PID $FRONTEND_PID

# If we get here, one process exited
echo "⚠️  A service exited unexpectedly"
cleanup
