"""
SportSync API - Database Connection.

Creates the SQLAlchemy engine and session factory.
All database access goes through sessions created here.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from config import settings

if settings.database_url.startswith("sqlite"):
    raise RuntimeError(
        "SQLite is no longer supported. Configure DATABASE_URL for PostgreSQL."
    )

engine = create_engine(
    settings.database_url,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
)

# Session factory for creating database sessions in request handlers
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class for all ORM models
Base = declarative_base()


def get_db():
    """
    Dependency that yields a database session per request.
    Automatically closes the session when the request finishes.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
