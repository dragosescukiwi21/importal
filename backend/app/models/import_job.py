import enum
import uuid

from sqlalchemy import Column, Integer, String, JSON, DateTime, ForeignKey, Enum, UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.base import Base

# Import models using strings in relationships to avoid circular imports


class ImportStatus(str, enum.Enum):
    PENDING_VALIDATION = "PENDING_VALIDATION"  # Portal upload waiting for user to complete wizard
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    PROMOTING = "PROMOTING"  # API job being promoted to database-managed
    SAVING = "SAVING"  # Bulk save operation in progress
    VALIDATING = "VALIDATING"
    VALIDATED = "VALIDATED"
    IMPORTING = "IMPORTING"
    COMPLETED = "COMPLETED"
    UNCOMPLETED = "UNCOMPLETED"  # For imports with conflicts that need fixing
    FAILED = "FAILED"


class ImportSource(str, enum.Enum):
    """
    Defines the source/origin of an import job.
    Set once at creation time and never changes.
    """
    API = "api"         # Created via REST API (by-key endpoint) - headless/programmatic
    PORTAL = "portal"   # Created via web UI wizard - user-facing


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID, ForeignKey("users.id"), nullable=False)
    importer_id = Column(UUID, ForeignKey("importers.id"), nullable=False)
    file_name = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)  # csv, xlsx, etc.
    import_source = Column(
        Enum(ImportSource, values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ImportSource.PORTAL,
        server_default="portal"
    )  # Source of the import: API or Portal
    status = Column(Enum(ImportStatus), default=ImportStatus.PENDING, nullable=False)
    row_count = Column(Integer, default=0, nullable=False)
    processed_rows = Column(Integer, default=0, nullable=False)
    error_count = Column(Integer, default=0, nullable=False)
    errors = Column(JSON, nullable=True)  # Store validation errors
    column_mapping = Column(
        JSON, nullable=True
    )  # Mapping of file columns to schema fields
    file_metadata = Column(JSON, nullable=True)  # Additional metadata
    processed_data = Column(
        JSON, nullable=True
    )  # Store processed data (valid and invalid records)
    error_message = Column(
        String, nullable=True
    )  # Store error message if processing fails
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships - using simple string references
    user = relationship("User", back_populates="import_jobs")
    importer = relationship("Importer", back_populates="import_jobs")
    webhook_events = relationship(
        "WebhookEvent", 
        back_populates="import_job",
        cascade="all, delete-orphan",
        passive_deletes=True
    )
    
    valid_csv_path = Column(String, nullable=True)   # Path to the CSV of valid rows
    invalid_csv_path = Column(String, nullable=True) # Path to the CSV of invalid rows

