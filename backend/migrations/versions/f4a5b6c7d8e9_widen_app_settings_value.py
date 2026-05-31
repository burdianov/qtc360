"""widen app_settings value to text

Revision ID: f4a5b6c7d8e9
Revises: d906b7cd54e2
Create Date: 2026-05-31 22:24:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'f4a5b6c7d8e9'
down_revision: Union[str, Sequence[str], None] = 'd906b7cd54e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('app_settings', 'value', type_=sa.Text(), existing_type=sa.String(500))


def downgrade() -> None:
    op.alter_column('app_settings', 'value', type_=sa.String(500), existing_type=sa.Text())
