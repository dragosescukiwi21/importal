"""Empty migration - placeholder

Revision ID: f45e8c9d1234
Revises: 5f36acf6203c
Create Date: 2025-08-21 00:18:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f45e8c9d1234'
down_revision: Union[str, None] = '5f36acf6203c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
