import shutil
import tempfile
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
import subprocess
from pathlib import Path
from .analyzer import RepoAnalyzer
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Repo Graph Visualizer")

# разрешаем CORS для фронтенда (локально)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# монтируем статику
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")
app.mount("/templates", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "templates")), name="templates")


class RepoRequest(BaseModel):
    repo_url: str


@app.post("/analyze")
async def analyze_repo(req: RepoRequest):
    url = req.repo_url.strip()
    if not (url.startswith("https://github.com/") or url.startswith("git@github.com:")):
        raise HTTPException(status_code=400, detail="Only GitHub URLs are supported (public repos).")

    tmpdir = tempfile.mkdtemp(prefix="repo_")
    try:
        # клонируем репозиторий в tmpdir/repo
        repo_dir = os.path.join(tmpdir, "repo")
        # используем git clone --depth 1
        try:
            subprocess.check_output(["git", "clone", "--depth", "1", url, repo_dir], stderr=subprocess.STDOUT, timeout=120)
        except subprocess.CalledProcessError as e:
            raise HTTPException(status_code=400, detail=f"git clone failed: {e.output.decode(errors='ignore')}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"git clone error: {str(e)}")

        analyzer = RepoAnalyzer(repo_dir)
        analyzer.analyze()
        data = analyzer.to_json()
        return JSONResponse(content={"ok": True, "data": data})
    finally:
        # убираем временную папку (чистим)
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


@app.get("/", response_class=HTMLResponse)
async def index():
    path = Path(__file__).parent / "templates" / "index.html"
    return HTMLResponse(content=path.read_text(encoding="utf-8"), status_code=200)
