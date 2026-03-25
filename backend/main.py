"""
SportSync API Service - FastAPI Application Entry Point.

Configures middleware, mounts routers, and starts the application.
All business logic lives in services/, not here.
"""
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from config import BACKEND_DIR, settings
from constants import APP_TITLE, APP_VERSION, APP_DESCRIPTION
from database import engine, Base, SessionLocal
from models.game import Game
from models.team import Team
from routers import auth, user, teams, scores, games, predictions, feed, sports
from services.security_service import get_client_ip, ip_is_allowed
from services.team_seed_service import seed_reference_teams

# Import all models so tables are registered with SQLAlchemy
import models.user  # noqa: F401
import models.team  # noqa: F401
import models.game  # noqa: F401
import models.prediction  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Run startup tasks and optional local-only schema bootstrap."""
    if settings.database_auto_create:
        Base.metadata.create_all(bind=engine)

    _seed_reference_teams_if_needed()

    # Auto-retrain the ML model in background (don't block server startup)
    try:
        import threading
        t = threading.Thread(target=_auto_retrain_if_needed, daemon=True)
        t.start()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Auto-retrain skipped: %s", exc)

    yield


def _auto_retrain_if_needed():
    """Retrain the ML model if the DB has enough data and model is stale."""
    import logging
    import time
    from pathlib import Path
    from database import SessionLocal

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        db_final_count = db.query(Game).filter(Game.status == "final").count()
        if db_final_count < 50:
            logger.info("Only %d final games in DB, skipping auto-retrain.", db_final_count)
            return

        # Retrain if model doesn't exist or is older than 1 hour
        model_path = Path(__file__).resolve().parent / "ml" / "model.pkl"
        should_retrain = False
        if not model_path.exists():
            should_retrain = True
        else:
            age_seconds = time.time() - model_path.stat().st_mtime
            if age_seconds > 3600:
                should_retrain = True

        if should_retrain:
            logger.info("Auto-retraining model with %d final games...", db_final_count)
            from ml.train import train_models
            summary = train_models()
            logger.info("Auto-retrain complete: %s", summary.get("model_version"))
            from ml import predict as _p
            _p._MODEL_BUNDLE = None
            _p._MODEL_MTIME = None
        else:
            logger.info("Model is recent (< 1h old). Skipping retrain.")
    finally:
        db.close()


def _seed_reference_teams_if_needed() -> None:
    """Populate the teams table on fresh environments before serving requests."""
    import logging

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        existing_teams = db.query(Team).count()
        if existing_teams > 0:
            logger.info("Reference teams already present (%d rows).", existing_teams)
            return

        summary = seed_reference_teams(db)
        logger.info(
            "Seeded reference teams on startup (created=%d updated=%d).",
            summary.get("created", 0),
            summary.get("updated", 0),
        )
    except Exception as exc:
        logger.warning("Reference team seed skipped: %s", exc)
    finally:
        db.close()


app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
    lifespan=lifespan,
)
logger = logging.getLogger("sportsync.api")

uploads_dir = (BACKEND_DIR / "uploads").resolve()
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)

# CORS configured to allow only specific origins, never wildcard
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


def _request_is_secure(request: Request) -> bool:
    forwarded_proto = str(request.headers.get("x-forwarded-proto") or "").strip().lower()
    if forwarded_proto:
        return forwarded_proto == "https"
    return request.url.scheme == "https"


@app.middleware("http")
async def enforce_api_security_and_logging(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    started_at = time.perf_counter()
    path = request.url.path
    client_ip = get_client_ip(request)

    if path.startswith("/api/") and settings.api_ip_allowlist_list:
        if not ip_is_allowed(client_ip, settings.api_ip_allowlist_list):
            response = JSONResponse(
                status_code=403,
                content={"detail": "IP address is not allowed"},
            )
            response.headers["X-Request-ID"] = request_id
            logger.warning(
                "api_ip_blocked",
                extra={"request_id": request_id, "client_ip": client_ip, "path": path},
            )
            return response

    is_internal_health_probe = path == "/api/health"

    if (
        path.startswith("/api/")
        and not is_internal_health_probe
        and settings.environment.lower() == "production"
        and not _request_is_secure(request)
    ):
        response = JSONResponse(
            status_code=400,
            content={"detail": "HTTPS is required"},
        )
        response.headers["X-Request-ID"] = request_id
        logger.warning(
            "api_https_required",
            extra={"request_id": request_id, "client_ip": client_ip, "path": path},
        )
        return response

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        logger.exception(
            "api_request_failed",
            extra={
                "request_id": request_id,
                "client_ip": client_ip,
                "method": request.method,
                "path": path,
                "duration_ms": duration_ms,
            },
        )
        raise

    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    response.headers["X-Request-ID"] = request_id
    log_payload = {
        "request_id": request_id,
        "client_ip": client_ip,
        "method": request.method,
        "path": path,
        "status_code": response.status_code,
        "duration_ms": duration_ms,
    }
    if response.status_code >= 500:
        logger.error("api_request_complete", extra=log_payload)
    elif response.status_code in {401, 403, 429}:
        logger.warning("api_request_complete", extra=log_payload)
    else:
        logger.info("api_request_complete", extra=log_payload)

    return response

# Mount all route handlers
app.include_router(auth.router)
app.include_router(user.router)
app.include_router(teams.router)
app.include_router(scores.router)
app.include_router(games.router)
app.include_router(predictions.router)
app.include_router(feed.router)
app.include_router(sports.router)


@app.get("/api/health")
async def health_check():
    """Minimal health endpoint for load balancer and Docker checks."""
    return {"status": "healthy", "version": APP_VERSION}
