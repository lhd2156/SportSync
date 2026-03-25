"""Add user role column for RBAC

Revision ID: 003
Revises: 002
Create Date: 2026-03-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(length=20), nullable=False, server_default="user"),
    )
    users_table = sa.table("users", sa.column("role", sa.String(length=20)))
    bind = op.get_bind()
    bind.execute(
        users_table.update()
        .where(sa.or_(users_table.c.role.is_(None), users_table.c.role == ""))
        .values(role="user")
    )
    op.alter_column("users", "role", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "role")
