"""
SportSync API Service - FastAPI Application Entry Point.

Configures middleware, mounts routers, and starts the application.
All business logic lives in services/, not here.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from constants import APP_TITLE, APP_VERSION, APP_DESCRIPTION
from database import engine, Base
from routers import auth, user, teams, scores, games, predictions, feed

# Import all models so tables are registered with SQLAlchemy
import models.user  # noqa: F401
import models.team  # noqa: F401
import models.game  # noqa: F401
import models.prediction  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables on startup (for local SQLite dev)."""
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
    lifespan=lifespan,
)

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


@app.get("/api/health")
async def health_check():
    """Minimal health endpoint for load balancer and Docker checks."""
    return {"status": "healthy", "version": APP_VERSION}

