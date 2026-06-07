"""add display_name to requirement_templates

Revision ID: 999b90bee605
Revises: c0491d729b64
Create Date: 2026-06-07 12:17:11.119780

"""

from alembic import op
import sqlalchemy as sa

revision: str = "999b90bee605"
down_revision: str | None = "c0491d729b64"
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.add_column(
        "requirement_templates",
        sa.Column("display_name", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("requirement_templates", "display_name")
