from __future__ import annotations

import os
from pathlib import Path
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Smart Rough Cut"
    API_V1_PREFIX: str = "/api"
    
    # Paths - ROOT_DIR points to project root (OnSpotly-main)
    ROOT_DIR: Path = Path(__file__).resolve().parents[3]
    BACKEND_DIR: Path = Path(__file__).resolve().parents[2]
    FOOTAGE_DIR: Path = ROOT_DIR / "footage"
    UPLOADS_DIR: Path = BACKEND_DIR / "uploads"
    RENDERS_DIR: Path = BACKEND_DIR / "renders"
    
    # Tool Paths (fallback to system PATH)
    FFMPEG_PATH: str = "ffmpeg"
    FFPROBE_PATH: str = "ffprobe"
    
    # NVIDIA NIM
    NVIDIA_API_KEY: str = ""
    NVIDIA_MODEL: str = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
    NVIDIA_BASE_URL: str = "https://integrate.api.nvidia.com/v1"

    class Config:
        extra = "allow"

def load_settings() -> Settings:
    settings = Settings()
    settings.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    settings.RENDERS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Look for .env or .env.local in root or backend
    for env_path in [
        settings.ROOT_DIR / ".env",
        settings.ROOT_DIR / ".env.local",
        settings.BACKEND_DIR / ".env",
    ]:
        if env_path.exists():
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    if line.startswith("NVIDIA_API_KEY="):
                        settings.NVIDIA_API_KEY = line.split("=", 1)[1].strip()
                    elif line.startswith("MODEL="):
                        raw_model = line.split("=", 1)[1].strip()
                        if raw_model.startswith("nvidia-nim/"):
                            raw_model = raw_model.replace("nvidia-nim/", "")
                        settings.NVIDIA_MODEL = raw_model
            break

    # Resolve ffmpeg from PATH or imageio_ffmpeg bundle
    import shutil
    if not shutil.which(settings.FFMPEG_PATH) and not Path(settings.FFMPEG_PATH).exists():
        try:
            import imageio_ffmpeg
            settings.FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            settings.FFMPEG_PATH = "ffmpeg"

    if not shutil.which(settings.FFPROBE_PATH) and not Path(settings.FFPROBE_PATH).exists():
        settings.FFPROBE_PATH = "ffprobe"

    return settings

settings = load_settings()
