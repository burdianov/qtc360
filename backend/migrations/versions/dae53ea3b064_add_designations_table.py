"""add_designations_table

Revision ID: dae53ea3b064
Revises: 0003_document_attachments
Create Date: 2026-05-28 08:41:36.490024

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'dae53ea3b064'
down_revision: Union[str, None] = '0003_document_attachments'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create designations table
    op.create_table(
        'designations',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('is_deleted', sa.Boolean(), server_default=sa.text('false'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # Add designation_id column to users
    op.add_column('users', sa.Column('designation_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key('fk_users_designation_id', 'users', 'designations', ['designation_id'], ['id'])

    # Seed designations from existing user positions
    conn = op.get_bind()
    positions = conn.execute(
        sa.text("SELECT DISTINCT position FROM users WHERE position IS NOT NULL AND position != '' AND is_deleted = false")
    ).fetchall()

    for (pos,) in positions:
        conn.execute(
            sa.text("INSERT INTO designations (id, name) VALUES (gen_random_uuid(), :name) ON CONFLICT (name) DO NOTHING"),
            {"name": pos.strip()},
        )

    # Update users to reference the new designation
    conn.execute(sa.text("""
        UPDATE users SET designation_id = d.id
        FROM designations d
        WHERE users.position = d.name AND users.position IS NOT NULL
    """))


def downgrade() -> None:
    op.drop_constraint('fk_users_designation_id', 'users', type_='foreignkey')
    op.drop_column('users', 'designation_id')
    op.drop_table('designations')
