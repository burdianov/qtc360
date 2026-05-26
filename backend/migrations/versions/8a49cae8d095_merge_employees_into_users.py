"""merge employees into users

Revision ID: 8a49cae8d095
Revises: 1688fbd75c36
Create Date: 2026-05-27 01:18:52.422713

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8a49cae8d095'
down_revision: Union[str, Sequence[str], None] = '1688fbd75c36'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('phone', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('position', sa.String(length=255), nullable=True))
    op.drop_table('employees')


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'position')
    op.drop_column('users', 'phone')
    op.create_table('employees',
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('phone', sa.String(length=50), nullable=True),
        sa.Column('position', sa.String(length=255), nullable=True),
        sa.Column('project_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id']),
        sa.PrimaryKeyConstraint('id'),
    )
