from __future__ import annotations

import asyncio
import json
import shutil
import time
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from ..core.config import settings
from ..services.media_probe import MediaProber
from ..services.shot_planner import ShotPlanner
from ..services.realtime_shot_finder import RealtimeShotFinder
from ..services.scene_detector import SceneDetector
from ..services.renderer import VideoRenderer
from ..services.audio_transcriber import AudioTranscriber

router = APIRouter()

projects: Dict[str, Dict[str, Any]] = {}
scenes_cache: Dict[str, Any] = {}

class BriefRequest(BaseModel):
    brief: str = Field(min_length=5)

class ShotUpdate(BaseModel):
    title: Optional[str] = None
    detail: Optional[str] = None
    duration: Optional[int] = Field(default=None, ge=1, le=30)
    file: Optional[str] = None
    start: Optional[float] = Field(default=None, ge=0)
    end: Optional[float] = Field(default=None, ge=0)
    confidence: Optional[int] = Field(default=None, ge=0, le=100)
    quality: Optional[int] = Field(default=None, ge=0, le=100)
    reason: Optional[str] = None

class ShotCreate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    detail: str = Field(min_length=1, max_length=240)
    duration: int = Field(default=3, ge=1, le=30)

class ReorderRequest(BaseModel):
    shot_ids: List[str]

class TimelineRequest(BaseModel):
    clips: List[Dict[str, Any]]


def get_all_media_paths() -> Dict[str, Path]:
    paths: Dict[str, Path] = {}
    if settings.FOOTAGE_DIR.exists():
        for f in settings.FOOTAGE_DIR.glob("*.mp4"):
            paths[f.name] = f
    if settings.UPLOADS_DIR.exists():
        for f in settings.UPLOADS_DIR.iterdir():
            if f.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}:
                paths[f.name] = f
    return paths

def build_timeline_from_shots(shots: List[Dict[str, Any]]) -> Dict[str, Any]:
    clips = []
    current_time = 0.0
    for shot in shots:
        if shot.get("status") == "missing":
            continue
        start = float(shot.get("start", 0.0))
        end = float(shot.get("end", 0.0))
        dur = max(0.5, end - start)
        clips.append({
            "id": shot["id"],
            "title": shot["title"],
            "file": shot["file"],
            "source_start": start,
            "source_end": end,
            "start": round(current_time, 2),
            "duration": round(dur, 2),
            "confidence": shot.get("confidence", 90),
            "tone": shot.get("tone", "amber")
        })
        current_time += dur
    return {"clips": clips, "revision": int(time.time())}

def init_project_data(project_id: str, brief_text: Optional[str] = None, media_subset: Optional[Dict[str, Path]] = None) -> Dict[str, Any]:
    all_media = media_subset if media_subset is not None else get_all_media_paths()
    footage_items = []
    
    # Pre-detect scenes and probe streams
    project_scenes = {}
    for name, p in all_media.items():
        info = MediaProber.probe(p)
        footage_items.append({
            "name": name,
            "size": p.stat().st_size,
            "duration": info.duration,
            "width": info.width,
            "height": info.height,
            "fps": info.fps,
            "media_url": f"/api/media/{name}"
        })
        if name not in scenes_cache:
            scenes_cache[name] = SceneDetector.detect_scenes(p)
        project_scenes[name] = scenes_cache[name]

    brief = brief_text or "Make a warm, energetic 30-second reel for Bean & Bloom. Start outside, show coffee being made and the latte art, happy customers, pastries, my welcome, the ribbon cutting, and end with a toast."
    
    # 1. Dynamic AI Shot Planner (NVIDIA NIM or semantic narrative generator)
    planned = ShotPlanner.plan(brief, list(all_media.keys()))
    
    # 2. Real-time Shot Finder with genuine scene detection & quality metrics
    shots = []
    for p_shot in planned:
        match_res = RealtimeShotFinder.match_shot(p_shot, all_media, project_scenes)
        shots.append({
            "id": p_shot.get("shot_id", "S1"),
            "title": p_shot.get("name", "Shot"),
            "detail": p_shot.get("description", ""),
            "duration": p_shot.get("target_seconds", 3),
            "file": match_res["file"],
            "start": match_res["start"],
            "end": match_res["end"],
            "confidence": match_res["confidence"],
            "quality": match_res["quality"],
            "reason": match_res["reason"],
            "tone": p_shot.get("tone", "amber"),
            "tag": p_shot.get("tag", "HERO"),
            "status": match_res["status"],
            "media_url": f"/api/media/{match_res['file']}" if match_res["file"] else "",
            "alternatives": match_res.get("alternatives", [])
        })

    timeline = build_timeline_from_shots(shots)
    total_dur = sum(c["duration"] for c in timeline["clips"])

    proj = {
        "id": project_id,
        "brief": brief,
        "status": "editing",
        "progress": {"step": 5, "total": 5, "label": "Editing workspace ready"},
        "footage": footage_items,
        "shots": shots,
        "timeline": timeline,
        "history": [],
        "future": [],
        "total_duration": round(total_dur, 2),
        "target_duration": 30,
        "updated_at": time.time(),
        "created_at": time.time()
    }
    projects[project_id] = proj
    return proj

# Lazily initialized default project
def get_default_project() -> Dict[str, Any]:
    if "default" not in projects:
        projects["default"] = init_project_data("default")
    return projects["default"]

def get_project_or_404(project_id: str) -> Dict[str, Any]:
    if project_id not in projects:
        if project_id == "default":
            return get_default_project()
        return init_project_data(project_id)
    return projects[project_id]

# ----------------- Routes -----------------

@router.get("/state")
def get_global_state():
    proj = get_project_or_404("default")
    return {
        "brief": proj["brief"],
        "shots": proj["shots"],
        "footage": proj["footage"],
        "timeline": proj["timeline"],
        "total_duration": sum(c["duration"] for c in proj["timeline"]["clips"]),
        "target_duration": proj["target_duration"],
        "updated_at": proj["updated_at"],
        "processing": proj["progress"]
    }

@router.post("/projects")
async def create_project(brief: str = Form(...), files: List[UploadFile] = File(default=[])):
    project_id = str(uuid.uuid4())[:8]
    custom_media: Dict[str, Path] = {}
    
    for file in files:
        if file.filename:
            dest = settings.UPLOADS_DIR / Path(file.filename).name
            with dest.open("wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            custom_media[dest.name] = dest

    # If user provided files, use user files; otherwise fall back to all media
    active_media = custom_media if custom_media else get_all_media_paths()
    proj = init_project_data(project_id, brief, active_media)
    return {"id": project_id, "status": "processing"}

@router.get("/projects/{project_id}")
def get_project(project_id: str):
    return get_project_or_404(project_id)

@router.get("/projects/{project_id}/state")
def get_project_state(project_id: str):
    proj = get_project_or_404(project_id)
    return {
        "brief": proj["brief"],
        "shots": proj["shots"],
        "footage": proj["footage"],
        "timeline": proj["timeline"],
        "total_duration": round(sum(c["duration"] for c in proj["timeline"]["clips"]), 2),
        "target_duration": proj["target_duration"]
    }

@router.get("/projects/{project_id}/events")
async def project_events(project_id: str):
    proj = get_project_or_404(project_id)
    async def event_generator():
        stages = [
            (1, "Uploading footage"),
            (2, "Extracting scenes, frames and audio"),
            (3, "Understanding footage with AI"),
            (4, "Finding requested shots"),
            (5, "Building your first editing timeline")
        ]
        for step, label in stages:
            payload = {
                "status": "processing" if step < 5 else "editing",
                "progress": {"step": step, "total": 5, "label": label},
                "state": {"brief": proj["brief"], "footage": proj["footage"]}
            }
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(0.3)
    return StreamingResponse(event_generator(), media_type="text/event-stream")

@router.post("/projects/{project_id}/plan")
def rebuild_project_plan(project_id: str, payload: BriefRequest):
    proj = get_project_or_404(project_id)
    proj["brief"] = payload.brief
    all_media = get_all_media_paths()
    planned = ShotPlanner.plan(payload.brief, list(all_media.keys()))
    
    shots = []
    for p_shot in planned:
        match_res = RealtimeShotFinder.match_shot(p_shot, all_media, scenes_cache)
        shots.append({
            "id": p_shot.get("shot_id", "S1"),
            "title": p_shot.get("name", "Shot"),
            "detail": p_shot.get("description", ""),
            "duration": p_shot.get("target_seconds", 3),
            "file": match_res["file"],
            "start": match_res["start"],
            "end": match_res["end"],
            "confidence": match_res["confidence"],
            "quality": match_res["quality"],
            "reason": match_res["reason"],
            "tone": p_shot.get("tone", "amber"),
            "tag": p_shot.get("tag", "HERO"),
            "status": match_res["status"],
            "media_url": f"/api/media/{match_res['file']}" if match_res["file"] else "",
            "alternatives": match_res.get("alternatives", [])
        })
    proj["shots"] = shots
    proj["timeline"] = build_timeline_from_shots(shots)
    proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.patch("/projects/{project_id}/shots/{shot_id}")
def update_shot(project_id: str, shot_id: str, payload: ShotUpdate):
    proj = get_project_or_404(project_id)
    target = next((s for s in proj["shots"] if s["id"] == shot_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Shot not found")
    
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "title":
            target["title"] = v
        elif k == "detail":
            target["detail"] = v
        else:
            target[k] = v

    if target["file"] and target["end"] > target["start"]:
        target["status"] = "found"
        target["media_url"] = f"/api/media/{target['file']}"

    proj["timeline"] = build_timeline_from_shots(proj["shots"])
    proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.post("/projects/{project_id}/shots/reorder")
def reorder_shots(project_id: str, payload: ReorderRequest):
    proj = get_project_or_404(project_id)
    by_id = {s["id"]: s for s in proj["shots"]}
    if set(payload.shot_ids) != set(by_id.keys()):
        raise HTTPException(status_code=400, detail="Invalid shot id order list")
    proj["shots"] = [by_id[sid] for sid in payload.shot_ids]
    proj["timeline"] = build_timeline_from_shots(proj["shots"])
    proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.post("/projects/{project_id}/timeline")
def update_project_timeline(project_id: str, payload: TimelineRequest):
    proj = get_project_or_404(project_id)
    proj["history"].append(deepcopy(proj["timeline"]))
    proj["timeline"] = {"clips": payload.clips, "revision": int(time.time())}
    proj["future"].clear()
    proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.post("/projects/{project_id}/timeline/undo")
def undo_timeline(project_id: str):
    proj = get_project_or_404(project_id)
    if proj["history"]:
        proj["future"].insert(0, deepcopy(proj["timeline"]))
        proj["timeline"] = proj["history"].pop()
        proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.post("/projects/{project_id}/timeline/redo")
def redo_timeline(project_id: str):
    proj = get_project_or_404(project_id)
    if proj["future"]:
        proj["history"].append(deepcopy(proj["timeline"]))
        proj["timeline"] = proj["future"].pop(0)
        proj["updated_at"] = time.time()
    return get_project_state(project_id)

@router.post("/projects/{project_id}/footage/upload")
async def upload_footage(project_id: str, file: UploadFile = File(...)):
    proj = get_project_or_404(project_id)
    safe_name = Path(file.filename or "upload.mp4").name
    dest = settings.UPLOADS_DIR / safe_name
    with dest.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    info = MediaProber.probe(dest)
    rec = {
        "name": safe_name,
        "size": dest.stat().st_size,
        "duration": info.duration,
        "width": info.width,
        "height": info.height,
        "fps": info.fps,
        "media_url": f"/api/media/{safe_name}"
    }
    proj["footage"] = [f for f in proj["footage"] if f["name"] != safe_name] + [rec]
    scenes_cache[safe_name] = SceneDetector.detect_scenes(dest)
    proj["updated_at"] = time.time()
    return {"file": rec, "state": get_project_state(project_id)}

@router.post("/transcribe")
async def transcribe_audio_file(file: UploadFile = File(...)):
    suffix = Path(file.filename or "voice.webm").suffix.lower()
    temp_path = settings.UPLOADS_DIR / f"voice_{str(uuid.uuid4())[:8]}{suffix}"
    try:
        with temp_path.open("wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        text = AudioTranscriber.transcribe_audio(temp_path)
        return {"transcript": text, "success": bool(text)}
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)

@router.get("/media/{filename}")
def stream_media(filename: str):
    all_media = get_all_media_paths()
    p = all_media.get(Path(filename).name)
    if not p or not p.exists():
        raise HTTPException(status_code=404, detail="Media file not found")
    return FileResponse(p, media_type="video/mp4", filename=p.name)

# ----------------- Exports -----------------

@router.get("/projects/{project_id}/export/json")
def export_project_json(project_id: str):
    proj = get_project_or_404(project_id)
    payload = {
        "project": f"Smart Rough Cut - {project_id}",
        "brief": proj["brief"],
        "shots": proj["shots"],
        "timeline": proj["timeline"],
        "footage": proj["footage"],
        "exported_at": time.time()
    }
    return JSONResponse(
        payload,
        headers={"Content-Disposition": f'attachment; filename="smart-rough-cut-{project_id}.json"'}
    )

@router.get("/projects/{project_id}/export/csv")
def export_project_csv(project_id: str):
    proj = get_project_or_404(project_id)
    csv_text = VideoRenderer.generate_csv(project_id, proj["shots"], proj["timeline"]["clips"])
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="smart-rough-cut-clip-list-{project_id}.csv"'}
    )

@router.get("/projects/{project_id}/export/video")
@router.post("/projects/{project_id}/export/video")
def export_project_video(project_id: str):
    proj = get_project_or_404(project_id)
    out_file = settings.RENDERS_DIR / f"smart_rough_cut_render_{project_id}.mp4"
    all_media = get_all_media_paths()
    VideoRenderer.render(proj["timeline"]["clips"], all_media, out_file)
    return FileResponse(out_file, media_type="video/mp4", filename=f"smart-rough-cut-{project_id}.mp4")

@router.get("/export/json")
def global_export_json():
    return export_project_json("default")

@router.get("/export/csv")
def global_export_csv():
    return export_project_csv("default")

@router.get("/export/video")
@router.post("/export/video")
def global_export_video():
    return export_project_video("default")
