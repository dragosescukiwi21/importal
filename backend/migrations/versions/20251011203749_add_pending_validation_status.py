"""Add PENDING_VALIDATION status to importstatus enum

Revision ID: 20251011203749
Revises: 5f36acf6203c
Create Date: 2025-10-11 20:37:49.000000

This status is used for portal uploads where the user has uploaded a file
but hasn't yet completed the validation wizard. These imports should:
- NOT appear in the main dashboard imports list
- Be automatically cleaned up after 24 hours if abandoned
- Only be used for portal imports (not API imports)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20251011203749'
down_revision: Union[str, None] = '5f36acf6203c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

disable_transactions = True

def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE importstatus ADD VALUE 'PENDING_VALIDATION'")


def downgrade() -> None:
    """Downgrade schema."""
    # Note: PostgreSQL doesn't support removing enum values easily
    # Would require recreating the entire enum type
    pass
