import uuid
import json
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Dict, Any, List, Optional


# Field type enum for better type safety and validation
class FieldType(str, Enum):
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    EMAIL = "email"
    PHONE = "phone"
    BOOLEAN = "boolean"
    SELECT = "select"
    CUSTOM_REGEX = "custom_regex"


# Importer field definition
class ImporterField(BaseModel):
    name: str = Field(..., description="Unique identifier for the field")
    display_name: Optional[str] = Field(None, description="Human-readable name")
    type: str = Field(
        ..., description="Field data type"
    )  # Using str for backward compatibility
    required: bool = Field(False, description="Whether this field is required")
    description: Optional[str] = Field(None, description="Field description")
    must_match: bool = Field(
        False, description="Require that users must match this column"
    )
    not_blank: bool = Field(False, description="Value cannot be blank")
    example: Optional[str] = Field(None, description="Example value for the field")
    validation_error_message: Optional[str] = Field(
        None, description="Custom validation error message"
    )
    extra_rules: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Extra validation rules (e.g., {'sign': 'positive', 'format': 'MM/DD/YYYY'})"
    )

    @field_validator('extra_rules', mode='before')
    def coerce_extra_rules_if_string(cls, v):
        """Coerce legacy string representations into a dict while remaining idempotent.

        - If v is a JSON string representing a dict, parse and return it.
        - If v is a short legacy token like 'positive', convert to {'sign': 'positive'}.
        - If v is an empty string or falsy, return an empty dict.
        - If v is already a dict or other truthy value, pass it through unchanged.
        """
        import logging
        logger = logging.getLogger(__name__)
        
        result = None
        
        # If it's a string, try to parse JSON first (covers '{...}' stored as text)
        if isinstance(v, str):
            s = v.strip()
            if not s:
                result = {}
            else:
                # Try JSON parse
                try:
                    parsed = json.loads(s)
                    if isinstance(parsed, dict):
                        result = parsed
                except Exception:
                    # Not JSON, fall through to token mapping
                    pass
                
                if result is None:
                    # Legacy single-value rules
                    lowered = s.lower()
                    if lowered in ("positive", "negative"):
                        result = {"sign": lowered}
                    else:
                        # Fallback: return as a simple value wrapper to preserve information
                        result = {"value": s}
        elif v is None:
            # If it's None, ensure dict (None -> {})
            result = {}
        else:
            # If it's already a dict or other type, pass through
            result = v
        
        return result

    @model_validator(mode='before')
    @classmethod
    def convert_legacy_fields(cls, data: Any) -> Any:
        """Convert legacy top-level fields (validation_format, template) into extra_rules.

        This is idempotent: it will not overwrite keys already present in extra_rules.
        It operates safely on dict-like input (as Pydantic passes in raw data).
        """
        if not isinstance(data, dict):
            return data

        # Ensure extra_rules exists and is a dict
        extra = data.get('extra_rules') or {}
        if not isinstance(extra, dict):
            # If extra_rules came in as a string, let the field validator handle it later
            extra = {}

        # Convert validation_format -> extra_rules depending on type, only if key absent
        vf = data.get('validation_format')
        if vf:
            field_type = data.get('type', '')
            if field_type == 'number' and 'sign' not in extra:
                extra['sign'] = vf
            elif field_type == 'date' and 'format' not in extra:
                extra['format'] = vf
            elif field_type == 'custom_regex' and 'pattern' not in extra:
                extra['pattern'] = vf

        # Convert template -> extra_rules
        tpl = data.get('template')
        if tpl:
            field_type = data.get('type', '')
            if field_type == 'boolean' and 'template' not in extra:
                extra['template'] = tpl
            elif field_type == 'select' and 'options' not in extra:
                extra['options'] = tpl

        # Assign back only if we added/merged something
        data['extra_rules'] = extra

        # Remove legacy fields to avoid duplication
        data.pop('validation_format', None)
        data.pop('template', None)

        return data

    @field_validator("type")
    def validate_field_type(cls, v):
        # Validate that the field type is one of the allowed types
        allowed_types = [t.value for t in FieldType]
        if v not in allowed_types:
            raise ValueError(f"Field type must be one of: {', '.join(allowed_types)}")
        return v

    # Note: rely on Pydantic's default serialization. With the validators above
    # `extra_rules` will always be present as a dict for new and legacy inputs,
    # so overriding model_dump/dict is unnecessary and error-prone.

    class Config:
        from_attributes = True


# Base Importer model
class ImporterBase(BaseModel):
    name: str = Field(..., description="Name of the importer")
    description: Optional[str] = Field(None, description="Description of the importer")
    fields: List[ImporterField] = Field(..., description="Fields to import")
    webhook_url: Optional[str] = Field(
        None, description="URL where imported data is sent"
    )
    webhook_enabled: bool = Field(True, description="Whether to use webhook")
    include_data_in_webhook: Optional[bool] = Field(
        None, description="Include processed data in webhook"
    )
    truncate_data: Optional[bool] = Field(
        False, description="Whether to truncate data to sample size"
    )
    webhook_data_sample_size: Optional[int] = Field(
        None, description="Number of rows to include in webhook sample"
    )
    include_unmatched_columns: bool = Field(
        False, description="Include all unmatched columns in import"
    )
    filter_invalid_rows: bool = Field(
        False, description="Filter rows that fail validation"
    )
    disable_on_invalid_rows: bool = Field(
        False, description="Disable importing all data if there are invalid rows"
    )

    @field_validator("webhook_url")
    def validate_webhook_url(cls, v, info):
        webhook_enabled = (
            info.data.get("webhook_enabled", False) if hasattr(info, "data") else False
        )
        if webhook_enabled and not v:
            raise ValueError("webhook_url is required when webhook_enabled is True")
        return v

    class Config:
        from_attributes = True


# Importer creation model
class ImporterCreate(ImporterBase):
    pass


# Importer update model
class ImporterUpdate(BaseModel):
    name: Optional[str] = Field(None, description="Name of the importer")
    description: Optional[str] = Field(None, description="Description of the importer")
    fields: Optional[List[ImporterField]] = Field(None, description="Fields to import")
    webhook_url: Optional[str] = Field(
        None, description="URL where imported data is sent"
    )
    webhook_enabled: Optional[bool] = Field(None, description="Whether to use webhook")
    include_data_in_webhook: Optional[bool] = Field(
        None, description="Include processed data in webhook"
    )
    truncate_data: Optional[bool] = Field(
        None, description="Whether to truncate data to sample size"
    )
    webhook_data_sample_size: Optional[int] = Field(
        None, description="Number of rows to include in webhook sample"
    )
    include_unmatched_columns: Optional[bool] = Field(
        None, description="Include all unmatched columns in import"
    )
    filter_invalid_rows: Optional[bool] = Field(
        None, description="Filter rows that fail validation"
    )
    disable_on_invalid_rows: Optional[bool] = Field(
        None, description="Disable importing all data if there are invalid rows"
    )

    class Config:
        from_attributes = True


# Importer in DB
class ImporterInDBBase(ImporterBase):
    id: uuid.UUID
    key: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        orm_mode = True
        from_attributes = True
        json_encoders = {uuid.UUID: str}


# Importer to return via API
class Importer(ImporterInDBBase):
    # Inherits all fields and configuration from ImporterInDBBase
    
    @classmethod
    def model_validate(cls, obj, *, from_attributes=None, **kwargs):
        """Custom model_validate to ensure fields are properly parsed"""
        import logging
        logger = logging.getLogger(__name__)
        
        # Check if this is an ORM object (has __table__ attribute)
        if hasattr(obj, '__table__'):
            logger.info(f"[model_validate] Processing ORM object...")
            
            data = {}
            for field_name in cls.model_fields:
                if hasattr(obj, field_name):
                    value = getattr(obj, field_name)
                    
                    if field_name == 'fields' and value:
                        logger.info(f"[model_validate] Raw 'fields' from DB: {value}")
                        parsed_fields = []
                        for field_data in value:
                            if isinstance(field_data, dict):
                                # ✅ THE FIX IS HERE ✅
                                # Explicitly run the validation for the sub-model.
                                # This triggers the @model_validator and @field_validator
                                # on ImporterField, which cleans up legacy fields and
                                # correctly populates `extra_rules`.
                                validated_field = ImporterField.model_validate(field_data)
                                # Append the cleaned-up dictionary.
                                parsed_fields.append(validated_field.model_dump())
                            else:
                                parsed_fields.append(field_data) # Keep non-dict items as is
                        
                        logger.info(f"[model_validate] Parsed and validated 'fields': {parsed_fields}")
                        data[field_name] = parsed_fields
                    else:
                        data[field_name] = value
            
            return super().model_validate(data, from_attributes=False, **kwargs)
        else:
            return super().model_validate(obj, from_attributes=from_attributes, **kwargs)
