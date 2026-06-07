"""drop_users_position_column

Revision ID: 817cd846ce17
Revises: dae53ea3b064
Create Date: 2026-05-28

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "817cd846ce17"
down_revision: Union[str, None] = "dae53ea3b064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("users", "position")


def downgrade() -> None:
    op.add_column("users", sa.Column("position", sa.String(255), nullable=True))
