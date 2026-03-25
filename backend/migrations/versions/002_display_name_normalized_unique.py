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

    users_table = sa.table(
        "users",
        sa.column("display_name", sa.String(length=100)),
        sa.column("display_name_normalized", sa.String(length=100)),
    )

    bind = op.get_bind()
    bind.execute(
        users_table.update()
        .where(users_table.c.display_name.is_not(None))
        .values(
            display_name=sa.func.nullif(sa.func.btrim(users_table.c.display_name), ""),
            display_name_normalized=sa.func.nullif(
                sa.func.lower(sa.func.btrim(users_table.c.display_name)),
                "",
            ),
        )
    )

    duplicates = bind.execute(
        sa.select(users_table.c.display_name_normalized)
        .where(users_table.c.display_name_normalized.is_not(None))
        .group_by(users_table.c.display_name_normalized)
        .having(sa.func.count() > 1)
        .order_by(users_table.c.display_name_normalized)
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
