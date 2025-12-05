import os
import shutil
import subprocess
import tempfile
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from parser_module import analyze_python_repo

app = FastAPI(title="Code Graph Visualizer (FastAPI)")

# Allow CORS for convenience (adjust in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["*"],
)

# Serve static files from ./static
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve index
@app.get("/", response_class=FileResponse)
def index():
    index_path = os.path.join("static", "index.html")
    if not os.path.exists(index_path):
        raise HTTPException(status_code=500, detail="index.html not found")
    return index_path

@app.post("/analyze")
@app.get("/analyze")
def analyze(request: Request):
    """
    Accepts either:
      - POST JSON { "repo_url": "https://github.com/owner/repo.git" }
      - GET ?repo_url=...
    Clones the repo shallowly and runs the Python AST parser.
    """
    # retrieve repo param
    repo = None
    if request.method == "GET":
        repo = request.query_params.get("repo_url")
    else:
        try:
            body = request.json()
        except Exception:
            body = {}
        # FastAPI may provide JSON body in sync route as awaitable; handle generically:
        if isinstance(body, dict):
            repo = body.get("repo_url")
        # fallback to query param
        if not repo:
            repo = request.query_params.get("repo_url")

    if not repo:
        raise HTTPException(status_code=400, detail="repo_url is required as query param or JSON body")

    tmpdir = tempfile.mkdtemp(prefix="repo_")
    try:
        # Clone shallow to tmpdir
        res = subprocess.run(["git", "clone", "--depth", "1", repo, tmpdir], capture_output=True, text=True, timeout=120)
        if res.returncode != 0:
            raise HTTPException(status_code=400, detail=f"git clone failed: {res.stderr.strip()}")
        graph = analyze_python_repo(tmpdir)
        return JSONResponse(content=graph)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="git clone timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"internal error: {str(e)}")
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass
