# Multi-stage build for Unified Honey Engine - Snowflake Native App
# Stage 1: Build Next.js frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install frontend dependencies
RUN npm ci --only=production

# Copy frontend source code
COPY frontend/ ./

# Build the Next.js app (standalone mode)
RUN npm run build

# Stage 2: Python backend with Next.js standalone
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies including Node.js for Next.js standalone
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source code
COPY backend/ ./

# Copy Next.js standalone build from frontend-builder
# Next.js standalone mode creates these directories:
# .next/standalone - server code (includes server.js)
# .next/static - static assets
# public - public files
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static ./.next/static
COPY --from=frontend-builder /app/frontend/public ./public

# Copy startup script
COPY start.sh ./

# Fix Windows line endings and make executable
RUN sed -i 's/\r$//' start.sh && chmod +x start.sh

# Expose port 8080 (required by Snowflake SPCS)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Start services
CMD ["./start.sh"]
