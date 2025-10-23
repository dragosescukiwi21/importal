import uuid
from datetime import datetime

from pydantic import BaseModel, computed_field, field_validator
from typing import Dict, Any, List, Optional, Union

from app.models.import_job import ImportStatus, ImportSource


# Nested importer schema for import job responses
class ImporterInfo(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    
    @classmethod
    def from_orm_with_conversion(cls, obj):
        """Convert UUID fields to strings"""
        return cls(
            id=str(obj.id),
            name=obj.name,
            description=obj.description
        )
    
    class Config:
        from_attributes = True


# Base ImportJob model
class ImportJobBase(BaseModel):
    importer_id: uuid.UUID
    file_name: str
    file_type: str


# ImportJob creation model
class ImportJobCreate(ImportJobBase):
    pass


# ImportJob update model
class ImportJobUpdate(BaseModel):
    status: Optional[ImportStatus] = None
    processed_rows: Optional[int] = None
    error_count: Optional[int] = None
    errors: Optional[Dict[str, Any]] = None
    column_mapping: Optional[Dict[str, str]] = None
    file_metadata: Optional[Dict[str, Any]] = None


# ImportJob in DB
class ImportJobInDBBase(ImportJobBase):
    id: uuid.UUID
    user_id: uuid.UUID
    import_source: ImportSource  # NEW: Source of the import
    status: ImportStatus
    row_count: int
    processed_rows: int
    error_count: int
    errors: Optional[Union[Dict[str, Any], List]] = None
    column_mapping: Optional[Dict[str, str]] = None
    file_metadata: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None

    @field_validator('errors', mode='before')
    @classmethod
    def validate_errors(cls, v):
        """Convert empty list to None, keep dict as is"""
        if isinstance(v, list) and len(v) == 0:
            return None
        return v

    class Config:
        from_attributes = True


# ImportJob to return via API (Uses computed_field with different names and aliases)
class ImportJob(ImportJobInDBBase):
    importer: Optional[ImporterInfo] = None

    @computed_field(alias="id")  # Keep 'id' in JSON output using alias
    @property
    def id_str(self) -> str:  # Change property name
        return str(self.id)

    @computed_field(alias="user_id")  # Keep 'user_id' in JSON output
    @property
    def user_id_str(self) -> str:  # Change property name
        return str(self.user_id)

    @computed_field(alias="importer_id")  # Keep 'importer_id' in JSON output
    @property
    def importer_id_str(self) -> str:  # Change property name
        return str(self.importer_id)

    @field_validator('importer', mode='before')
    @classmethod
    def validate_importer(cls, v):
        """Convert importer UUID fields to strings"""
        if v and hasattr(v, 'id'):
            # Convert the importer object to ImporterInfo with string conversion
            return ImporterInfo.from_orm_with_conversion(v)
        return v

    class Config:
        from_attributes = True
        # Exclude the original UUID fields from the response if needed,
        # though aliasing might handle this implicitly. Let's try without exclude first.
        # exclude = {'id', 'user_id', 'importer_id'}


# Column mapping model
class ColumnMapping(BaseModel):
    file_column: str
    importer_field: str
    confidence: float = 0.0


# Column mapping request
class ColumnMappingRequest(BaseModel):
    mappings: List[ColumnMapping]


# Import request for importer-key based authentication
class ImportByKeyRequest(BaseModel):
    validData: List[Dict[str, Any]]
    invalidData: List[Dict[str, Any]] = []
    columnMapping: Dict[str, Any] = {}
    user: Dict[str, Any] = {}
    metadata: Dict[str, Any] = {}
    importer_key: uuid.UUID


# Simplified response for import processing
class ImportProcessResponse(BaseModel):
    success: bool
