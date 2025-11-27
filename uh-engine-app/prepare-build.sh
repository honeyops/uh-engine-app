#!/bin/bash
# Preparation script to copy source files from uh-engine to service directory for Snowflake Native App build

set -e

echo "Preparing Unified Honey Engine for Snowflake Native App build..."

# Define paths
UH_ENGINE_DIR="../../uh-engine"
SERVICE_DIR="./service"

# Clean the service directory (except Dockerfile and start.sh)
echo "Cleaning service directory..."
cd "$SERVICE_DIR"
find . -mindepth 1 ! -name 'Dockerfile' ! -name 'start.sh' -exec rm -rf {} + 2>/dev/null || true
cd ..

# Copy backend
echo "Copying backend..."
cp -r "$UH_ENGINE_DIR/backend" "$SERVICE_DIR/"

# Copy frontend
echo "Copying frontend..."
cp -r "$UH_ENGINE_DIR/frontend" "$SERVICE_DIR/"

# Copy configuration if it exists
if [ -d "$UH_ENGINE_DIR/configuration" ]; then
    echo "Copying configuration..."
    cp -r "$UH_ENGINE_DIR/configuration" "$SERVICE_DIR/"
else
    echo "No configuration directory found, skipping..."
fi

echo "✓ Build preparation complete!"
echo "You can now run: ./build-and-push.sh"
