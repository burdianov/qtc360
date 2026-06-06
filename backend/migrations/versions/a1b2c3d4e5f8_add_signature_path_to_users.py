"""add_signature_path_to_users

Revision ID: a1b2c3d4e5f8
Revises: 7a8b9c0d1e2f
Create Date: 2026-06-06 20:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f8'
down_revision: Union[str, None] = '7a8b9c0d1e2f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('signature_path', sa.String(500), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'signature_path')
