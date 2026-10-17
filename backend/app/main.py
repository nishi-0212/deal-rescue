"""Deal Rescue Agent API.

Run locally:   python -m uvicorn app.main:app --reload --port 8000
API docs:      http://localhost:8000/docs
"""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import get_settings
from .logging_setup import setup_logging
from .routers import actions, auth, dashboard, deals, demo, drafts, jobs, pipelines, uploads
from .services.jobs import runner

settings = get_settings()
setup_logging(settings.log_level)
log = logging.getLogger("deal_rescue")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await db.ensure_indexes(db.get_db())
    if not settings.analysis_inline:
        await runner.start()
    if settings.jwt_secret.startswith("dev-only") or len(settings.jwt_secret) < 32:
        log.warning("JWT_SECRET is weak or the default. Set a long random value in .env before deploying.")
    log.info("AI analysis: %s", f"Groq · {settings.groq_model}" if settings.llm_enabled else "off (rule-based only)")
    yield
    await runner.stop()
    await db.close()


app = FastAPI(
    title="Deal Rescue Agent API",
    version="1.0.0",
    description="Finds stalled deals, explains why with evidence, and builds a recovery plan.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Pipeline-Id"],
)


@app.middleware("http")
async def request_log(request: Request, call_next):
    rid = uuid.uuid4().hex[:8]
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("[%s] %s %s crashed", rid, request.method, request.url.path)
        return JSONResponse({"detail": "Something went wrong on our side. Please try again."}, status_code=500)
    ms = (time.perf_counter() - start) * 1000
    if request.url.path.startswith("/api"):
        log.info("[%s] %s %s -> %s (%.0f ms)", rid, request.method, request.url.path, response.status_code, ms)
    response.headers["X-Request-ID"] = rid
    return response


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]) or None, "message": e["msg"].replace("Value error, ", "")}
              for e in exc.errors()]
    first = errors[0]["message"] if errors else "Invalid request"
    return JSONResponse({"detail": first, "errors": errors}, status_code=422)


for r in (auth.router, pipelines.router, uploads.router, deals.router, actions.router, drafts.router, dashboard.router, jobs.router,
          demo.router):
    app.include_router(r)


@app.get("/api/health", tags=["meta"])
async def health() -> dict:
    return {"status": "ok", "ai": settings.llm_enabled, "model": settings.groq_model if settings.llm_enabled else None,
            "email_sending": settings.smtp_enabled}
