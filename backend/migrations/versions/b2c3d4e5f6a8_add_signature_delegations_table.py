"""add_signature_delegations_table

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f8
Create Date: 2026-06-06 21:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'b2c3d4e5f6a8'
down_revision: Union[str, None] = 'a1b2c3d4e5f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'signature_delegations',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('grantor_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('delegate_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_deleted', sa.Boolean(), server_default='false'),
        sa.UniqueConstraint('grantor_id', 'delegate_id', name='uq_delegation_grantor_delegate'),
    )


def downgrade() -> None:
    op.drop_table('signature_delegations')
