"""Add normalized display name uniqueness

Revision ID: 002
Revises: 001
Create Date: 2026-03-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("display_name_normalized", sa.String(length=100), nullable=True),
    )

    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE users
            SET
                display_name = NULLIF(BTRIM(display_name), ''),
                display_name_normalized = NULLIF(LOWER(BTRIM(display_name)), '')
            WHERE display_name IS NOT NULL
            """
        )
    )

    duplicates = bind.execute(
        sa.text(
            """
            SELECT display_name_normalized
            FROM users
            WHERE display_name_normalized IS NOT NULL
            GROUP BY display_name_normalized
            HAVING COUNT(*) > 1
            ORDER BY display_name_normalized
            """
        )
    ).fetchall()
    if duplicates:
        duplicate_values = ", ".join(row[0] for row in duplicates)
        raise RuntimeError(
            f"Cannot create unique display-name index; duplicate handles exist: {duplicate_values}"
        )

    op.create_index(
        "ix_users_display_name_normalized",
        "users",
        ["display_name_normalized"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_users_display_name_normalized", table_name="users")
    op.drop_column("users", "display_name_normalized")
