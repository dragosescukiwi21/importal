"""Add PROMOTING and SAVING status to importstatus enum

Revision ID: 5f36acf6203c
Revises: eae7ce2df428
Create Date: 2025-08-20 01:58:26.049838

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5f36acf6203c'
down_revision: Union[str, None] = 'eae7ce2df428'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

disable_transactions = True

def upgrade() -> None:
    """Upgrade schema."""
    op.execute("ALTER TYPE importstatus ADD VALUE 'PROMOTING'")
    op.execute("ALTER TYPE importstatus ADD VALUE 'SAVING'")
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
