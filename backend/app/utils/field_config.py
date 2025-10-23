# app/utils/field_config.py
"""
Helper utilities for working with importer field configurations.
"""

from typing import Dict, Any, Optional


class FieldConfig:
    """
    Wrapper class for importer field configurations to provide 
    clean conversion to validator format.
    """
    
    def __init__(self, field_dict: Dict[str, Any]):
        """Initialize from a dictionary (from JSON fields)."""
        self._data = field_dict
    
    @property
    def name(self) -> str:
        return self._data.get('name', '')
    
    @property
    def type(self) -> str:
        return self._data.get('type', 'string')
    
    @property
    def required(self) -> bool:
        return self._data.get('required', False)
    
    @property
    def max_length(self) -> Optional[int]:
        return self._data.get('max_length')
    
    @property
    def min_length(self) -> Optional[int]:
        return self._data.get('min_length')
    
    @property
    def validation_format(self) -> Optional[str]:
        return self._data.get('validation_format')
    
    @property
    def options(self) -> Optional[list]:
        return self._data.get('options')
    
    @property
    def pattern(self) -> Optional[str]:
        return self._data.get('pattern')
    
    @property
    def not_blank(self) -> bool:
        return self._data.get('not_blank', False)
    
    def to_validator_config(self) -> Dict[str, Any]:
        """
        Generates a dictionary configuration for the validation utility.
        This is the centralized place where field configurations are converted
        to the format expected by validate_field().
        """
        config = {
            "name": self.name,
            "type": self.type,
            "required": self.required,
            "not_blank": self.not_blank,
            "validation": {}
        }
        
        validation_rules = {
            "max_length": self.max_length,
            "min_length": self.min_length,
            "options": self.options,
            "pattern": self.pattern,
        }

        # --- KEY IMPROVEMENT ---
        # Translate the generic 'validation_format' into a specific rule key
        # based on the field's type.
        if self.validation_format:
            if self.type == 'number':
                validation_rules['validation_format'] = self.validation_format  # Numbers use validation_format
            elif self.type in ['date', 'datetime', 'boolean']:
                validation_rules['validation_format'] = self.validation_format  # Dates/booleans also use validation_format
        
        # Filter out any keys that have a None value
        config["validation"] = {k: v for k, v in validation_rules.items() if v is not None}
        
        return config
