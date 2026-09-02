# ============================================================
# app.py
# ============================================================
"""
Main FastAPI application entry point for the Instagram Analytics backend
(Feature 1: Social Graph & Follow Analytics).

Run with:
    uvicorn app:app --reload --port 8000

or directly:
    python app.py
"""

from __future__ import annotations

import logging

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.upload import router as upload_router
from routes.social import router as social_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

# Port the backend listens on. Kept as a single constant so both the
# `python app.py` entry point and any external tooling/docs reference
# the same value.
PORT = 8000
HOST = "0.0.0.0"

app = FastAPI(
    title="Instagram Data Analytics API",
    description=(
        "Backend for analyzing a user's exported Instagram 'connections' "
        "data. Feature 1: Social Graph & Follow Analytics."
    ),
    version="0.1.0",
)

# ------------------------------------------------------------------
# CORS
# ------------------------------------------------------------------
# Allows a separately-hosted frontend (e.g. a Vite/React dev server on
# localhost:5173 or localhost:3000) to call this API during development.
# Adjust `allow_origins` for production instead of using "*".
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload_router)
app.include_router(social_router)


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    """Simple liveness/status endpoint for testing the backend."""
    return {"status": "ok", "port": PORT}


if __name__ == "__main__":
    uvicorn.run("app:app", host=HOST, port=PORT, reload=True)