from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import cv2
import numpy as np
from ..core.config import settings

@dataclass
class SceneSegment:
    file: str
    file_path: Path
    start: float
    end: float
    duration: float
    quality: int
    sharpness: float
    brightness: float

class SceneDetector:
    """
    Real-time scene boundary extraction and visual quality scoring.
    Combines FFmpeg scene detection with OpenCV frame analysis.
    """

    @classmethod
    def detect_scenes(cls, video_path: Path, min_duration: float = 1.5, threshold: float = 0.3) -> List[SceneSegment]:
        if not video_path.exists():
            return []

        # 1. Probe total duration
        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        frames_count = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        total_duration = frames_count / fps if fps > 0 else 0.0
        cap.release()

        if total_duration <= 0.5:
            return []

        # 2. Run FFmpeg scene change filter (fast downscaled probe)
        pts: List[float] = []
        try:
            cmd = [
                settings.FFMPEG_PATH,
                "-i", str(video_path),
                "-vf", f"scale=320:-1,select=gt(scene\\,{threshold}),showinfo",
                "-f", "null", "-"
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
            raw_pts = re.findall(r"pts_time:([0-9.]+)", proc.stderr)
            pts = [round(float(p), 2) for p in raw_pts]
        except Exception as e:
            print(f"[SceneDetector] FFmpeg scene detection fallback on {video_path.name}: {e}")

        # Ensure start and end boundaries
        boundary_points = [0.0]
        for p in pts:
            if p > boundary_points[-1] + min_duration and p < total_duration - 0.5:
                boundary_points.append(p)
        boundary_points.append(round(total_duration, 2))

        # 3. Create segments and evaluate quality with OpenCV
        segments: List[SceneSegment] = []
        for i in range(len(boundary_points) - 1):
            s_start = boundary_points[i]
            s_end = boundary_points[i + 1]
            dur = s_end - s_start
            if dur < 1.0:
                continue

            quality, sharpness, brightness = cls._evaluate_quality(video_path, s_start, s_end)
            segments.append(SceneSegment(
                file=video_path.name,
                file_path=video_path,
                start=s_start,
                end=s_end,
                duration=round(dur, 2),
                quality=quality,
                sharpness=sharpness,
                brightness=brightness
            ))

        return segments

    @classmethod
    def _evaluate_quality(cls, video_path: Path, start_sec: float, end_sec: float, num_samples: int = 4) -> Tuple[int, float, float]:
        cap = cv2.VideoCapture(str(video_path))
        sample_times = np.linspace(start_sec, end_sec, num_samples)
        sharp_list = []
        bright_list = []

        for t in sample_times:
            cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
            ret, frame = cap.read()
            if not ret or frame is None:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            sharpness = cv2.Laplacian(gray, cv2.CV_64F).var()
            brightness = float(np.mean(gray))
            sharp_list.append(sharpness)
            bright_list.append(brightness)
        cap.release()

        avg_sharp = float(np.mean(sharp_list)) if sharp_list else 50.0
        avg_bright = float(np.mean(bright_list)) if bright_list else 128.0

        # Quality scoring (sharpness + balanced brightness 40-200)
        norm_sharp = min(100.0, (avg_sharp / 400.0) * 60.0)
        norm_bright = 40.0 if (40.0 <= avg_bright <= 210.0) else 20.0
        final_quality = int(np.clip(norm_sharp + norm_bright, 25, 98))

        return final_quality, round(avg_sharp, 1), round(avg_bright, 1)

