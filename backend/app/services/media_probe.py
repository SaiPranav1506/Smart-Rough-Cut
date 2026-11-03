from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from ..core.config import settings

@dataclass
class VideoStreamInfo:
    codec: str
    width: int
    height: int
    fps: float
    duration: float
    bitrate: int
    has_audio: bool
    audio_codec: Optional[str] = None

class MediaProber:
    """Probes video metadata using ffprobe with robust fallback handling."""

    @staticmethod
    def probe(file_path: Path) -> VideoStreamInfo:
        cmd = [
            settings.FFPROBE_PATH,
            "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration,bit_rate",
            "-show_entries", "format=duration,size,bit_rate",
            "-of", "json",
            str(file_path),
        ]
        
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, check=True)
            data = json.loads(res.stdout)
            
            video_stream = None
            audio_stream = None
            for s in data.get("streams", []):
                if s.get("codec_type") == "video" and not video_stream:
                    video_stream = s
                elif s.get("codec_type") == "audio" and not audio_stream:
                    audio_stream = s

            format_info = data.get("format", {})
            
            # FPS calculation
            fps = 30.0
            if video_stream and "r_frame_rate" in video_stream:
                num, den = video_stream["r_frame_rate"].split("/")
                fps = float(num) / float(den) if float(den) > 0 else 30.0

            duration = 0.0
            if format_info.get("duration"):
                duration = float(format_info["duration"])
            elif video_stream and video_stream.get("duration"):
                duration = float(video_stream["duration"])

            bitrate = int(format_info.get("bit_rate") or (video_stream.get("bit_rate") if video_stream else 0) or 2_500_000)

            return VideoStreamInfo(
                codec=video_stream.get("codec_name", "h264") if video_stream else "unknown",
                width=int(video_stream.get("width", 1280)) if video_stream else 1280,
                height=int(video_stream.get("height", 720)) if video_stream else 720,
                fps=round(fps, 2),
                duration=round(duration, 2),
                bitrate=bitrate,
                has_audio=audio_stream is not None,
                audio_codec=audio_stream.get("codec_name") if audio_stream else None
            )
        except Exception as e:
            # OpenCV fallback if ffprobe parsing fails
            import cv2
            cap = cv2.VideoCapture(str(file_path))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
            duration = frames / fps if fps > 0 else 0.0
            cap.release()
            
            return VideoStreamInfo(
                codec="h264",
                width=width,
                height=height,
                fps=round(fps, 2),
                duration=round(duration, 2),
                bitrate=2_500_000,
                has_audio=True
            )

