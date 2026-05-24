from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from storage import list_simulations, get_signed_url

app = FastAPI(title="Collision Simulation API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ── Models ──────────────────────────────────────────────────────────────────

class SimulationItem(BaseModel):
    id: str
    name: str
    size: int
    last_modified: str


class SignedUrlResponse(BaseModel):
    url: str
    expires_in: int


# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/api/simulations", response_model=list[SimulationItem])
def list_sims():
    """列出所有可用仿真文件。"""
    try:
        return list_simulations()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/simulations/{sim_id}/signed-url", response_model=SignedUrlResponse)
def signed_url(sim_id: str):
    """获取指定仿真文件的临时下载链接（有效期由 SIGNED_URL_EXPIRES 控制）。"""
    try:
        url = get_signed_url(sim_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    if url is None:
        raise HTTPException(status_code=404, detail=f"Simulation '{sim_id}' not found")
    return SignedUrlResponse(url=url, expires_in=settings.SIGNED_URL_EXPIRES)


@app.get("/health")
def health():
    return {"status": "ok"}
