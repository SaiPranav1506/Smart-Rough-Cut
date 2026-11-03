from __future__ import annotations

import csv
import io
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional
from ..core.config import settings

class VideoRenderer:
    """
    Smart Rough Cut Video Assembly & Export Engine.
    Executes professional multi-clip concatenation using FFmpeg with filter graphs,
    proper audio resampling, aspect ratio conforming, and deterministic output.
    """

    @classmethod
    def render(cls, clips: List[Dict[str, Any]], media_paths: Dict[str, Path], output_path: Path) -> Path:
        valid_clips = []
        for c in clips:
            fname = c.get("file")
            if not fname or fname not in media_paths:
                continue
            src = media_paths[fname]
            if not src.exists():
                continue
            dur = c.get("source_end", 0.0) - c.get("source_start", 0.0)
            if dur <= 0.1:
                continue
            valid_clips.append(c)

        if not valid_clips:
            raise RuntimeError("No valid footage clips available for rendering.")

        # Create temporary segments first or run complex filter_complex
        # Using fast stream cut & concat protocol
        temp_dir = Path(tempfile.mkdtemp(prefix="smart_rough_cut_render_"))
        segment_files = []

        try:
            for idx, clip in enumerate(valid_clips):
                src = media_paths[clip["file"]]
                seg_file = temp_dir / f"seg_{idx:03d}.mp4"
                start = clip.get("source_start", 0.0)
                end = clip.get("source_end", 0.0)
                duration = max(0.1, end - start)

                # Conform to 1280x720 30fps yuv420p with audio track
                cmd = [
                    settings.FFMPEG_PATH,
                    "-y",
                    "-ss", str(start),
                    "-t", str(duration),
                    "-i", str(src),
                    "-f", "lavfi", "-t", str(duration), "-i", "anullsrc=r=44100:cl=stereo",
                    "-filter_complex",
                    "[0:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v];"
                    "[0:a][1:a]amix=inputs=2:duration=first[a]",
                    "-map", "[v]",
                    "-map", "[a]",
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-crf", "22",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "128k",
                    "-ar", "44100",
                    str(seg_file)
                ]

                # Run segment rendering
                res = subprocess.run(cmd, capture_output=True, text=True)
                if res.returncode != 0 or not seg_file.exists():
                    # Fallback without audio mixing if anullsrc or complex audio fails
                    cmd_fallback = [
                        settings.FFMPEG_PATH,
                        "-y",
                        "-ss", str(start),
                        "-t", str(duration),
                        "-i", str(src),
                        "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30",
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-crf", "22",
                        "-pix_fmt", "yuv420p",
                        "-an",
                        str(seg_file)
                    ]
                    subprocess.run(cmd_fallback, capture_output=True, check=True)

                segment_files.append(seg_file)

            # Concat demuxer
            concat_txt = temp_dir / "concat_list.txt"
            with open(concat_txt, "w", encoding="utf-8") as f:
                for seg in segment_files:
                    f.write(f"file '{seg.resolve().as_posix()}'\n")

            output_path.parent.mkdir(parents=True, exist_ok=True)
            concat_cmd = [
                settings.FFMPEG_PATH,
                "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_txt),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_path)
            ]
            subprocess.run(concat_cmd, capture_output=True, check=True)

            return output_path
        finally:
            # Clean up temp segments
            for seg in segment_files:
                try:
                    seg.unlink(missing_ok=True)
                except Exception:
                    pass
            try:
                (temp_dir / "concat_list.txt").unlink(missing_ok=True)
                temp_dir.rmdir()
            except Exception:
                pass

    @classmethod
    def generate_csv(cls, project_id: str, shots: List[Dict[str, Any]], timeline_clips: List[Dict[str, Any]]) -> str:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "order",
            "shot_id",
            "name",
            "source_file",
            "source_start",
            "source_end",
            "timeline_start",
            "timeline_end",
            "duration",
            "status",
            "confidence",
            "quality",
            "reason"
        ])

        clip_map = {c.get("id"): c for c in timeline_clips}

        for idx, shot in enumerate(shots):
            shot_id = shot.get("id")
            clip = clip_map.get(shot_id)
            if clip:
                t_start = clip.get("start", 0.0)
                t_dur = clip.get("duration", 0.0)
                t_end = round(t_start + t_dur, 2)
                src_file = clip.get("file", "")
                src_start = clip.get("source_start", 0.0)
                src_end = clip.get("source_end", 0.0)
                dur = round(src_end - src_start, 2)
            else:
                t_start = 0.0
                t_end = 0.0
                src_file = shot.get("file", "")
                src_start = shot.get("start", 0.0)
                src_end = shot.get("end", 0.0)
                dur = round(src_end - src_start, 2) if src_end > src_start else shot.get("duration", 3.0)

            writer.writerow([
                idx + 1,
                shot.get("id", f"S{idx+1}"),
                shot.get("title", ""),
                src_file,
                src_start,
                src_end,
                t_start,
                t_end,
                dur,
                shot.get("status", "found"),
                shot.get("confidence", 0),
                shot.get("quality", 0),
                shot.get("reason", "")
            ])

        return output.getvalue()

