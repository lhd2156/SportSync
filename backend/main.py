"""
SportSync API Service - FastAPI Application Entry Point.

Configures middleware, mounts routers, and starts the application.
All business logic lives in services/, not here.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import BACKEND_DIR, settings
from constants import APP_TITLE, APP_VERSION, APP_DESCRIPTION
from database import engine, Base, SessionLocal
from models.game import Game
from models.team import Team
from routers import auth, user, teams, scores, games, predictions, feed, sports
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

uploads_dir = (BACKEND_DIR / "uploads").resolve()
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# CORS configured to allow only specific origins, never wildcard
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

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
