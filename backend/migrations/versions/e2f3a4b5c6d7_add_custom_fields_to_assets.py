"""add custom_fields jsonb to assets

Revision ID: e2f3a4b5c6d7
Revises: 9baac946c1e9
Create Date: 2026-05-30
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "e2f3a4b5c6d7"
down_revision = "9baac946c1e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assets", sa.Column("custom_fields", JSONB, server_default="{}", nullable=False)
    )
    # Seed default custom field definition (rename "location" to "POD")
    op.execute("""
        INSERT INTO app_settings (id, key, value)
        VALUES (gen_random_uuid(), 'asset_custom_fields', '[{"id":"field_1","label":"POD"}]')
        ON CONFLICT (key) DO NOTHING
    """)
    # Migrate existing location data into custom_fields
    op.execute("""
        UPDATE assets
        SET custom_fields = jsonb_build_object('field_1', COALESCE(location, ''))
        WHERE location IS NOT NULL AND location != ''
    """)


def downgrade() -> None:
    op.drop_column("assets", "custom_fields")
