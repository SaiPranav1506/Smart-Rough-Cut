from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .core.config import settings
from .api.routes import router as api_router

def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart Rough Cut API",
        description="Automatic AI video editing and rough cut assembly pipeline",
        version="2.0.0"
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix="/api")

    @app.get("/")
    def health_check():
        return {
            "service": "Smart Rough Cut",
            "version": "2.0.0",
            "status": "operational",
            "ffmpeg": settings.FFMPEG_PATH,
            "nim_model": settings.NVIDIA_MODEL
        }

    return app

app = create_app()

