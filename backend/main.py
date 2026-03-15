"""
SportSync API Service - FastAPI Application Entry Point.

Configures middleware, mounts routers, and starts the application.
All business logic lives in services/, not here.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from constants import APP_TITLE, APP_VERSION, APP_DESCRIPTION

app = FastAPI(
    title=APP_TITLE,
    version=APP_VERSION,
    description=APP_DESCRIPTION,
)

# CORS configured to allow only specific origins, never wildcard
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
async def health_check():
    """Minimal health endpoint for load balancer and Docker checks."""
    return {"status": "healthy", "version": APP_VERSION}
