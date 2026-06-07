"""add file_format to doc_templates

Revision ID: 39b56e7da051
Revises: 999b90bee605
Create Date: 2026-06-07 12:20:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision: str = '39b56e7da051'
down_revision: str | None = '999b90bee605'
branch_labels: None = None
depends_on: None = None


def upgrade() -> None:
    op.add_column('doc_templates', sa.Column('file_format', sa.String(10), server_default='docx', nullable=False))


def downgrade() -> None:
    op.drop_column('doc_templates', 'file_format')
