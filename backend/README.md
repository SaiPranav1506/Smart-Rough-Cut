# Smart Rough Cut API

Local FastAPI service for the Smart Rough Cut prototype.

```powershell
cd project\backend
python -m uvicorn main:app --reload --port 8000
```

The API uses the supplied footage files, a deterministic local planner/matcher, and FFmpeg for MP4 rough-cut export. No API key is required.

Useful endpoints:

- `GET /api/state`
- `POST /api/plan`
- `POST /api/match`
- `PATCH /api/shots/{shot_id}`
- `POST /api/shots/reorder`
- `POST /api/footage/upload`
- `GET /api/export/json`
- `POST /api/export/video`
