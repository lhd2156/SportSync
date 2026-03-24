"""
Upload the built frontend static assets to S3-compatible object storage.

Usage:
    python scripts/sync_static_assets.py --build-dir ../frontend/dist
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.storage_service import upload_static_directory


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload built frontend assets to object storage.")
    parser.add_argument(
        "--build-dir",
        default=str((Path(__file__).resolve().parents[2] / "frontend" / "dist")),
        help="Path to the built frontend directory (default: ../frontend/dist)",
    )
    parser.add_argument(
        "--prefix",
        default="",
        help="Object storage key prefix for uploaded files.",
    )
    args = parser.parse_args()

    build_dir = Path(args.build_dir).resolve()
    uploaded = upload_static_directory(build_dir, prefix=args.prefix)
    print(f"uploaded={len(uploaded)}")
    if uploaded:
        print(uploaded[0])
        print(uploaded[-1])


if __name__ == "__main__":
    main()
