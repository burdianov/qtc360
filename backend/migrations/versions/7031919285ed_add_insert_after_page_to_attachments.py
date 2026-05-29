"""add_insert_after_page_to_attachments

Revision ID: 7031919285ed
Revises: c3d4e5f6a7b8
Create Date: 2026-05-29 10:40:29.717854

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7031919285ed'
down_revision: Union[str, Sequence[str], None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('document_attachments', sa.Column('insert_after_page', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('document_attachments', 'insert_after_page')
