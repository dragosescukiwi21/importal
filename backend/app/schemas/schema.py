import uuid
from datetime import datetime

from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional, Literal


# Schema field definition
class SchemaField(BaseModel):
    name: str
    display_name: Optional[str] = None
    type: str  # text, number, date, email, phone, boolean, select, custom_regex
    required: bool = False
    description: Optional[str] = None
    must_match: bool = False  # Require that users must match this column
    not_blank: bool = False  # Value cannot be blank
    example: Optional[str] = None  # Example value for the field
    validation_error_message: Optional[str] = None  # Custom validation error message
    extra_rules: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Extra validation rules for specific field types (e.g., number: positive/negative, date: format, boolean: template)"
    )
    validation: Optional[Dict[str, Any]] = None  # JSON Schema validation rules

    def model_dump(self, *args, **kwargs):
        # Ensure all fields are serializable
        result = super().model_dump(*args, **kwargs)
        # Always include extra_rules to preserve field rules
        cleaned_result = {}
        for k, v in result.items():
            # Always include extra_rules, even if it's empty, to preserve field rules
            if v is not None or k == "extra_rules":
                cleaned_result[k] = v
        # Ensure extra_rules is always a dict
        if not cleaned_result.get("extra_rules"):
            cleaned_result["extra_rules"] = {}
        return cleaned_result

    def dict(self, *args, **kwargs):
        # Ensure all fields are serializable
        result = super().dict(*args, **kwargs)
        # Always include extra_rules to preserve field rules
        cleaned_result = {}
        for k, v in result.items():
            # Always include extra_rules, even if it's empty, to preserve field rules
            if v is not None or k == "extra_rules":
                cleaned_result[k] = v
        # Ensure extra_rules is always a dict
        if not cleaned_result.get("extra_rules"):
            cleaned_result["extra_rules"] = {}
        return cleaned_result

    class Config:
        from_attributes = True


# Base Schema model
class SchemaBase(BaseModel):
    name: str
    description: Optional[str] = None
    fields: List[SchemaField]

    class Config:
        from_attributes = True


# Schema creation model
class SchemaCreate(SchemaBase):
    pass


# Schema update model
class SchemaUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[List[SchemaField]] = None


# Schema in DB
class SchemaInDBBase(SchemaBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Schema to return via API
class Schema(SchemaInDBBase):
    # Convert UUID fields to strings for API responses
    id: str
    user_id: str

    class Config:
        from_attributes = True
