#!/usr/bin/env python3
"""
FastAPI application for Unified Honey Engine v2
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pathlib import Path
import traceback
import logging
from api.routes import utilities, blueprints, dimensional_models, openflow, governance, dashboard

# Configure logging - only show errors
logging.basicConfig(
    level=logging.ERROR,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Unified Honey Engine API",
    description="API for managing data pipelines and database operations",
    version="2.0.0",
    openapi_url="/api-spec.json",
    docs_url=None,
    redoc_url="/redoc",
    root_path=""  # This ensures API routes work correctly behind proxy
)

# Add global exception handler to log full tracebacks for unhandled exceptions
# This will catch exceptions that aren't already handled by FastAPI's built-in handlers
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler that logs full tracebacks"""
    # Skip HTTPException and RequestValidationError as they're handled by FastAPI
    from fastapi.exceptions import HTTPException, RequestValidationError
    if isinstance(exc, (HTTPException, RequestValidationError)):
        raise exc
    
    # Log the full traceback for unhandled exceptions
    logger.error(
        f"Unhandled exception in {request.method} {request.url.path}: {type(exc).__name__}: {str(exc)}\n"
        f"Traceback:\n{traceback.format_exc()}",
        exc_info=True
    )
    # Return error response with traceback in development
    import os
    if os.getenv("ENVIRONMENT", "development") == "development":
        return JSONResponse(
            status_code=500,
            content={
                "detail": str(exc),
                "type": type(exc).__name__,
                "traceback": traceback.format_exc()
            }
        )
    else:
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"}
        )

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve local static files for Swagger UI to avoid external CDN blocks in SPCS
BASE_DIR = Path(__file__).resolve().parent
# In unified container, app.py is in /app/, so static/swagger is a sibling directory
SWAGGER_DIR = BASE_DIR / "static" / "swagger"

# Only mount static files if directory exists
if SWAGGER_DIR.exists() and SWAGGER_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(SWAGGER_DIR)), name="static")

# Mount Next.js static assets (must be before catch-all route)
NEXTJS_STATIC_DIR = BASE_DIR / ".next" / "static"
if NEXTJS_STATIC_DIR.exists() and NEXTJS_STATIC_DIR.is_dir():
    app.mount("/_next/static", StaticFiles(directory=str(NEXTJS_STATIC_DIR)), name="nextjs_static")

# Serve public files at root (for logo_full.svg, etc.)
# This needs special handling to not conflict with API routes
PUBLIC_DIR = BASE_DIR / "public"

# Include routers
app.include_router(utilities.router, prefix="/api/v1", tags=["utilities"])
app.include_router(blueprints.router, prefix="/api/v1", tags=["blueprints"])
app.include_router(dimensional_models.router, prefix="/api/v1", tags=["dimensional-models"])
app.include_router(openflow.router, prefix="/api/v1", tags=["openflow"])
app.include_router(governance.router, prefix="/api/v1", tags=["governance"])
app.include_router(dashboard.router, prefix="/api/v1", tags=["dashboard"])

@app.get("/docs", include_in_schema=False)
async def custom_swagger_ui_html():
    # Force Swagger UI to use locally served assets to avoid CDN blocks in SPCS
    # Custom HTML to include standalone preset JS
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <link type="text/css" rel="stylesheet" href="/static/swagger-ui.css">
        <link rel="shortcut icon" href="https://fastapi.tiangolo.com/img/favicon.png">
        <title>Unified Honey Engine API Docs</title>
    </head>
    <body>
        <div id="swagger-ui"></div>
        <script src="/static/swagger-ui-bundle.js"></script>
        <script src="/static/swagger-ui-standalone-preset.js"></script>
        <script>
        const ui = SwaggerUIBundle({{
            url: '/api-spec.json',
            dom_id: '#swagger-ui',
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
            ],
            layout: "BaseLayout",
            deepLinking: true,
            showExtensions: true,
            showCommonExtensions: true
        }})
        </script>
    </body>
    </html>
    """
    return HTMLResponse(content=html)

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Serve public files (images, fonts, etc.) from /public directory
from fastapi.responses import FileResponse
import os

@app.get("/{filename:path}.{ext}")
async def serve_public_files(filename: str, ext: str):
    """Serve public static files like images, fonts, etc."""
    # Only serve common static file types
    allowed_extensions = ['svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot']
    if ext.lower() not in allowed_extensions:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not Found")

    file_path = PUBLIC_DIR / f"{filename}.{ext}"
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)

    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail="Not Found")

# Proxy all other requests to Next.js frontend
from fastapi.responses import StreamingResponse
from fastapi import Request
import httpx

async def proxy_to_frontend_handler(request: Request, full_path: str):
    """
    Proxy requests to Next.js frontend running on port 3000
    This ensures the frontend handles routing for non-API paths
    """
    # Skip if it's a FastAPI API route (already handled above)
    # But allow Next.js API routes (like /api/model-catalog/...) to pass through
    if full_path.startswith("api/v1/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Not Found")

    async with httpx.AsyncClient() as client:
        try:
            # Get request body if present
            body = await request.body() if request.method in ["POST", "PUT", "PATCH"] else None
            
            # Prepare headers, excluding ones that shouldn't be forwarded
            forward_headers = {}
            for key, value in request.headers.items():
                # Skip headers that shouldn't be forwarded
                if key.lower() not in ['host', 'content-length', 'connection', 'transfer-encoding']:
                    forward_headers[key] = value
            
            # Forward the request to Next.js with the same method
            response = await client.request(
                request.method,
                f"http://localhost:3000/{full_path}",
                content=body,
                headers=forward_headers,
                follow_redirects=True,
                timeout=30.0
            )

            # Return the response from Next.js
            # Exclude compression headers since we're returning decoded content
            headers = dict(response.headers)
            headers.pop("content-encoding", None)
            headers.pop("content-length", None)  # Length changes after decompression

            return StreamingResponse(
                iter([response.content]),
                status_code=response.status_code,
                headers=headers,
                media_type=response.headers.get("content-type")
            )
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=502, detail=f"Frontend unavailable: {str(e)}")

@app.get("/{full_path:path}")
async def proxy_get(request: Request, full_path: str):
    """Proxy GET requests to Next.js"""
    return await proxy_to_frontend_handler(request, full_path)

@app.post("/{full_path:path}")
async def proxy_post(request: Request, full_path: str):
    """Proxy POST requests to Next.js"""
    return await proxy_to_frontend_handler(request, full_path)

@app.put("/{full_path:path}")
async def proxy_put(request: Request, full_path: str):
    """Proxy PUT requests to Next.js"""
    return await proxy_to_frontend_handler(request, full_path)

@app.patch("/{full_path:path}")
async def proxy_patch(request: Request, full_path: str):
    """Proxy PATCH requests to Next.js"""
    return await proxy_to_frontend_handler(request, full_path)

@app.delete("/{full_path:path}")
async def proxy_delete(request: Request, full_path: str):
    """Proxy DELETE requests to Next.js"""
    return await proxy_to_frontend_handler(request, full_path)
