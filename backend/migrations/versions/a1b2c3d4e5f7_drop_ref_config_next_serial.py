"""drop reference_number_configs.next_serial (dead since discipline counter)

Revision ID: a1b2c3d4e5f7
Revises: d9f29178ab55
Create Date: 2026-06-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, Sequence[str], None] = "d9f29178ab55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("reference_number_configs", "next_serial")


def downgrade() -> None:
    op.add_column(
        "reference_number_configs",
        sa.Column("next_serial", sa.Integer(), nullable=False, server_default="1"),
    )
