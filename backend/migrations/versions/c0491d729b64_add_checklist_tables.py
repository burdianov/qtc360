"""add checklist tables

Revision ID: c0491d729b64
Revises: b2c3d4e5f6a8
Create Date: 2026-06-07 00:19:49.807568

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c0491d729b64'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('checklist_items',
        sa.Column('requirement_template_id', sa.UUID(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.ForeignKeyConstraint(['requirement_template_id'], ['requirement_templates.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_checklist_items_requirement_template_id', 'checklist_items', ['requirement_template_id'])

    op.create_table('document_checklists',
        sa.Column('document_id', sa.UUID(), nullable=False),
        sa.Column('requirement_template_id', sa.UUID(), nullable=False),
        sa.Column('comments', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False),
        sa.Column('attachment_id', sa.UUID(), nullable=True),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.ForeignKeyConstraint(['attachment_id'], ['document_attachments.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['document_id'], ['documents.id']),
        sa.ForeignKeyConstraint(['requirement_template_id'], ['requirement_templates.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_document_checklists_document_id', 'document_checklists', ['document_id'])

    op.create_table('document_checklist_responses',
        sa.Column('checklist_id', sa.UUID(), nullable=False),
        sa.Column('checklist_item_id', sa.UUID(), nullable=False),
        sa.Column('response', sa.String(length=3), nullable=False),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('item_text', sa.Text(), nullable=False),
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.ForeignKeyConstraint(['checklist_id'], ['document_checklists.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['checklist_item_id'], ['checklist_items.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_document_checklist_responses_checklist_id', 'document_checklist_responses', ['checklist_id'])


def downgrade() -> None:
    op.drop_index('ix_document_checklist_responses_checklist_id', table_name='document_checklist_responses')
    op.drop_table('document_checklist_responses')
    op.drop_index('ix_document_checklists_document_id', table_name='document_checklists')
    op.drop_table('document_checklists')
    op.drop_index('ix_checklist_items_requirement_template_id', table_name='checklist_items')
    op.drop_table('checklist_items')
