#!/bin/bash
set -e  # Exit on error

echo "Starting UH Engine services..."

# Start Next.js (standalone mode) on port 3000 in background
echo "Starting Next.js frontend on port 3000..."
cd /app
if [ -f server.js ]; then
    echo "server.js found, starting Next.js..."
    PORT=3000 HOSTNAME=0.0.0.0 node server.js 2>&1 &
    NEXTJS_PID=$!
    echo "Next.js started with PID: $NEXTJS_PID"
    
    # Wait a bit for Next.js to initialize
    sleep 3
    
    # Verify Next.js is still running
    if ! kill -0 $NEXTJS_PID 2>/dev/null; then
        echo "ERROR: Next.js failed to start"
        exit 1
    fi
else
    echo "WARNING: server.js not found in /app - continuing without Next.js"
    NEXTJS_PID=""
fi

# Start FastAPI on port 8080 (Snowflake Native App requirement) in background
# FastAPI must start regardless of Next.js status for health checks
echo "Starting FastAPI backend on port 8080..."
cd /app
uvicorn app:app --host 0.0.0.0 --port 8080 &
FASTAPI_PID=$!
echo "FastAPI started with PID: $FASTAPI_PID"

# Verify FastAPI started successfully
sleep 2
if ! kill -0 $FASTAPI_PID 2>/dev/null; then
    echo "ERROR: FastAPI failed to start"
    exit 1
fi

echo "Services started successfully:"
echo "  FastAPI PID: $FASTAPI_PID"
if [ ! -z "$NEXTJS_PID" ]; then
    echo "  Next.js PID: $NEXTJS_PID"
    # Wait for both processes (container exits if either dies)
    wait $NEXTJS_PID $FASTAPI_PID
else
    # Wait only for FastAPI
    wait $FASTAPI_PID
fi
