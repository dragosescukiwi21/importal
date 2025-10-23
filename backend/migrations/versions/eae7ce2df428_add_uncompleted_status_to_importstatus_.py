"""Add UNCOMPLETED status to importstatus enum

Revision ID: eae7ce2df428
Revises: afc08705fd33
Create Date: 2025-08-10 18:59:57.311609

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'eae7ce2df428'
down_revision: Union[str, None] = 'afc08705fd33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE importstatus ADD VALUE 'UNCOMPLETED'")


def downgrade() -> None:
    """Downgrade schema."""
    pass
