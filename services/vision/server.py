#!/usr/bin/env python3
"""
services/vision/server.py
--------------------------
FastAPI inference server for SolarVision YOLOv8.

Endpoints:
    GET  /health           → { status, model, uptime_s }
    GET  /vision/model     → { modelPath, classes, version }
    POST /vision/infer     → { detections: VisionDetection[] }

Environment variables:
    VISION_MODEL_PATH      path to .pt checkpoint (default: auto-detect)
    VISION_CONF_THRESHOLD  default confidence threshold (default: 0.25)
    VISION_IOU_THRESHOLD   default IoU NMS threshold  (default: 0.45)
    VISION_PORT            server port                (default: 8001)
    VISION_HOST            bind host                  (default: 0.0.0.0)
    VISION_WORKERS         number of uvicorn workers  (default: 1)
    VISION_LOG_LEVEL       uvicorn log level          (default: info)
    VISION_API_KEY         optional bearer token guard (default: disabled)

Usage:
    python3 server.py
    VISION_MODEL_PATH=models/solarvision.pt python3 server.py
    uvicorn server:app --host 0.0.0.0 --port 8001 --workers 1
"""

from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

# ─── FastAPI / Pydantic ────────────────────────────────────────────────────────
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# ─── local inference module ───────────────────────────────────────────────────
from infer import (
    CLASS_NAMES,
    DEFAULT_CONF,
    DEFAULT_IOU,
    load_model,
    run_inference,
)

# ─── logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SERVER] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("solarvision.server")

# ─── config from env ──────────────────────────────────────────────────────────
PORT        = int(os.getenv("VISION_PORT",      "8001"))
HOST        = os.getenv("VISION_HOST",          "0.0.0.0")
WORKERS     = int(os.getenv("VISION_WORKERS",   "1"))
LOG_LEVEL   = os.getenv("VISION_LOG_LEVEL",     "info")
API_KEY     = os.getenv("VISION_API_KEY",       "")   # empty = disabled
MODEL_PATH  = os.getenv("VISION_MODEL_PATH",    "")

SERVICE_VERSION = "1.0.0"

# ─── startup time ─────────────────────────────────────────────────────────────
_start_time = time.time()


# ═══════════════════════════════════════════════════════════════════════════════
# Pydantic request / response models
# ═══════════════════════════════════════════════════════════════════════════════

class InferRequest(BaseModel):
    imageUrl:   str   = Field(...,  description="Publicly accessible image URL or absolute local path")
    conf:       float = Field(DEFAULT_CONF,  ge=0.01, le=1.0, description="Confidence threshold")
    iou:        float = Field(DEFAULT_IOU,   ge=0.01, le=1.0, description="IoU NMS threshold")
    modelPath:  Optional[str] = Field(None, description="Override model checkpoint path")

    @field_validator("imageUrl")
    @classmethod
    def image_url_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("imageUrl must not be empty")
        return v


class BBoxNorm(BaseModel):
    x:      float
    y:      float
    width:  float
    height: float


class BBoxPixels(BaseModel):
    x:      int
    y:      int
    width:  int
    height: int


class VisionDetection(BaseModel):
    type:        str
    classId:     int
    bbox:        BBoxNorm
    bboxPixels:  BBoxPixels
    confidence:  float
    imageWidth:  int
    imageHeight: int


class InferResponse(BaseModel):
    source:          str
    modelPath:       str
    imageWidth:      int
    imageHeight:     int
    inferenceMs:     float
    detectionCount:  int
    detections:      List[VisionDetection]


class HealthResponse(BaseModel):
    status:     str
    version:    str
    model:      str
    uptimeS:    float


class ModelInfoResponse(BaseModel):
    modelPath:  str
    classes:    List[str]
    numClasses: int
    version:    str


# ═══════════════════════════════════════════════════════════════════════════════
# App setup
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="SolarVision Inference API",
    description="YOLOv8-powered roof object detection for solar site surveys",
    version=SERVICE_VERSION,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── optional API key guard ───────────────────────────────────────────────────

async def _check_api_key(request: Request) -> None:
    """If VISION_API_KEY is set, require Authorization: Bearer <key>."""
    if not API_KEY:
        return
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = auth[len("Bearer "):]
    if token != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")


# ═══════════════════════════════════════════════════════════════════════════════
# Startup: pre-load model
# ═══════════════════════════════════════════════════════════════════════════════

@app.on_event("startup")
async def startup_event() -> None:
    log.info("SolarVision server v%s starting on %s:%d", SERVICE_VERSION, HOST, PORT)
    try:
        load_model(MODEL_PATH or None)
        log.info("Model pre-loaded ✓")
    except Exception as exc:
        log.warning("Model pre-load failed (will retry on first request): %s", exc)


# ═══════════════════════════════════════════════════════════════════════════════
# Routes
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    """Liveness check — always returns 200 if the server is running."""
    from infer import _cached_model_path
    return HealthResponse(
        status   = "ok",
        version  = SERVICE_VERSION,
        model    = _cached_model_path or "not loaded",
        uptimeS  = round(time.time() - _start_time, 1),
    )


@app.get("/vision/model", response_model=ModelInfoResponse, tags=["meta"])
async def model_info(
    _: None = Depends(_check_api_key),
) -> ModelInfoResponse:
    """Return loaded model metadata and class list."""
    from infer import _cached_model_path
    return ModelInfoResponse(
        modelPath  = _cached_model_path or MODEL_PATH or "auto",
        classes    = CLASS_NAMES,
        numClasses = len(CLASS_NAMES),
        version    = SERVICE_VERSION,
    )


@app.post("/vision/infer", response_model=InferResponse, tags=["inference"])
async def infer(
    body: InferRequest,
    _:    None = Depends(_check_api_key),
) -> InferResponse:
    """
    Run YOLOv8 inference on an image.

    - **imageUrl**: URL or local path of the roof photo
    - **conf**: confidence threshold (default 0.25)
    - **iou**: IoU NMS threshold (default 0.45)
    - **modelPath**: optional override for the model checkpoint
    """
    log.info("POST /vision/infer  url=%s  conf=%.2f  iou=%.2f",
             body.imageUrl[:80], body.conf, body.iou)
    try:
        result = run_inference(
            image_source=body.imageUrl,
            model_path  =body.modelPath or (MODEL_PATH or None),
            conf        =body.conf,
            iou         =body.iou,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        log.error("Inference error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Inference failed: {exc}")

    return InferResponse(**result)


# ─── global exception handler ─────────────────────────────────────────────────

@app.exception_handler(Exception)
async def _global_handler(request: Request, exc: Exception) -> JSONResponse:
    log.error("Unhandled exception on %s: %s", request.url.path, exc, exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )


# ═══════════════════════════════════════════════════════════════════════════════
# Entry point
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "server:app",
        host      =HOST,
        port      =PORT,
        workers   =WORKERS,
        log_level =LOG_LEVEL,
        reload    =False,
    )