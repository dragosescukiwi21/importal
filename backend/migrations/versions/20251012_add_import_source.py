"""add import_source field to import_jobs

Revision ID: 20251012_add_import_source
Revises: 20251011203749
Create Date: 2025-10-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '20251012_add_import_source'
down_revision = '20251011203749'
branch_labels = None
depends_on = None


def upgrade():
    # Create the import source enum type
    import_source_enum = postgresql.ENUM('api', 'portal', name='importsource', create_type=True)
    import_source_enum.create(op.get_bind(), checkfirst=True)
    
    # Add import_source column with default value 'portal'
    op.add_column(
        'import_jobs',
        sa.Column(
            'import_source',
            sa.Enum('api', 'portal', name='importsource'),
            nullable=False,
            server_default='portal'
        )
    )
    
    # Backfill API imports based on file_name pattern
    # API imports typically have file_name = "embedded_import.csv"
    op.execute(
        """
        UPDATE import_jobs 
        SET import_source = 'api' 
        WHERE file_name = 'embedded_import.csv' 
           OR file_path = '' 
           OR file_path IS NULL
        """
    )
    
    # Optional: Create index for faster queries by import_source
    op.create_index(
        'ix_import_jobs_import_source',
        'import_jobs',
        ['import_source'],
        unique=False
    )


def downgrade():
    # Drop index first
    op.drop_index('ix_import_jobs_import_source', table_name='import_jobs')
    
    # Drop column
    op.drop_column('import_jobs', 'import_source')
    
    # Drop enum type
    sa.Enum(name='importsource').drop(op.get_bind(), checkfirst=True)
