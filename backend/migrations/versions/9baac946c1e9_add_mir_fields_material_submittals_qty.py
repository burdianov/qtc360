"""add_mir_fields_material_submittals_qty

Revision ID: 9baac946c1e9
"""

from alembic import op
import sqlalchemy as sa

revision = "9baac946c1e9"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "documents", sa.Column("material_submittals", sa.Text(), nullable=True)
    )
    op.add_column("documents", sa.Column("qty", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("documents", "qty")
    op.drop_column("documents", "material_submittals")
