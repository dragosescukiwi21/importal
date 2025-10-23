# app/utils/validator.py
"""
Python version of the TypeScript validator logic.
Performs the same validation checks as admin/lib/validator.ts
"""

import re
import math
import logging
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


def validate_number(value: str, rules: Dict[str, Any] = None, field_type: str = 'number') -> Optional[str]:
    """
    Number validator with support for positive/negative sign rules.
    Rule properties: `subtype` ('integer'), `sign` ('positive' | 'negative' | 'any')
    Also handles 'integer' field type.
    """
    if rules is None:
        rules = {}
    
    # Check for common non-numeric patterns (consistent with validation_service.py)
    if "@" in value:
        return "Value appears to contain an email address but should be a number"
    
    if value.startswith(("http://", "https://")):
        return "Value appears to contain a URL but should be a number"
    
    try:
        num_value = float(value)
        # Explicitly check for NaN values
        if math.isnan(num_value):
            return 'Must be a valid number'
    except ValueError:
        return 'Must be a valid number'
    
    # Check if integer type or subtype
    if field_type == 'integer' or rules.get('subtype') == 'integer':
        if not num_value.is_integer():
            return 'Must be a whole number'
    
    # Enforce sign using validation_format (canonical), fallback to sign for backward compatibility
    sign = rules.get('validation_format') or rules.get('sign')
    logger.debug(f'[validate_number] value: {value}, num_value: {num_value}, validation_format/sign: {sign}')
    
    if sign == 'positive' and num_value <= 0:
        return 'Must be a positive number'
    elif sign == 'negative' and num_value >= 0:
        return 'Must be a negative number'
    
    return None


def validate_date(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """
    Date validator with strict format support.
    Rule properties: `format` ('any' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY/MM/DD' | 'YYYY-MM-DD').
    
    Improvements (matching validation_service.py):
    - Check specific format FIRST if provided before trying common formats
    - Accept common numeric-only dates like YYYYMMDD when format is Any
    - Support strict 'YYYY-MM-DD' and dot formats like 'YYYY.MM.DD'
    - Treat 'Any' case-insensitively
    """
    if rules is None:
        rules = {}
    
    # Use validation_format as canonical, fallback to format for backward compatibility
    format_rule = rules.get('validation_format') or rules.get('format', '')
    fmt_upper = format_rule.upper() if format_rule else ''
    logger.debug(f'[validate_date] value: {value}, validation_format/format: {format_rule}')
    
    # IMPORTANT: Check specific format FIRST if provided
    if fmt_upper and fmt_upper != 'ANY':
        if fmt_upper == 'MM/DD/YYYY':
            # Must match MM/DD/YYYY format with any delimiter (/, -, .)
            match = re.match(r'^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{4})$', value)
            if not match:
                return f'Must be in MM/DD/YYYY format'
            try:
                # Extract the parts and validate as a date
                month, day, year = match.groups()
                datetime.strptime(f"{month}/{day}/{year}", '%m/%d/%Y')
                return None  # Valid!
            except ValueError:
                return f'Must be a valid date in MM/DD/YYYY format'
        elif fmt_upper == 'DD/MM/YYYY':
            # Must match DD/MM/YYYY format with any delimiter (/, -, .)
            match = re.match(r'^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{4})$', value)
            if not match:
                return f'Must be in DD/MM/YYYY format'
            try:
                # Extract the parts and validate as a date
                day, month, year = match.groups()
                datetime.strptime(f"{day}/{month}/{year}", '%d/%m/%Y')
                return None  # Valid!
            except ValueError:
                return f'Must be a valid date in DD/MM/YYYY format'
        elif fmt_upper == 'YYYY/MM/DD':
            # Must match YYYY/MM/DD format with any delimiter (/, -, .)
            match = re.match(r'^(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})$', value)
            if not match:
                return f'Must be in YYYY/MM/DD format'
            try:
                # Extract the parts and validate as a date
                year, month, day = match.groups()
                datetime.strptime(f"{year}/{month}/{day}", '%Y/%m/%d')
                return None  # Valid!
            except ValueError:
                return f'Must be a valid date in YYYY/MM/DD format'
        elif fmt_upper == 'YYYY-MM-DD':
            # Must match YYYY-MM-DD format with any delimiter (/, -, .)
            match = re.match(r'^(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})$', value)
            if not match:
                return f'Must be in YYYY-MM-DD format'
            try:
                # Extract the parts and validate as a date
                year, month, day = match.groups()
                datetime.strptime(f"{year}-{month}-{day}", '%Y-%m-%d')
                return None  # Valid!
            except ValueError:
                return f'Must be a valid date in YYYY-MM-DD format'
        # If specific format is set but doesn't match any known format
        else:
            logger.warning(f'Unknown date format \'{fmt_upper}\' specified')
    
    # Handle numeric-only values for "Any" format
    if re.match(r'^\d+$', value):
        # Allow common compact formats when format is ANY or unspecified
        if fmt_upper in {'', 'ANY'}:
            # Try YYYYMMDD
            if len(value) == 8:
                try:
                    datetime.strptime(value, '%Y%m%d')
                    return None
                except ValueError:
                    pass
            # Try YYYYMM
            if len(value) == 6:
                try:
                    datetime.strptime(value + '01', '%Y%m%d')
                    return None
                except ValueError:
                    pass
        # Fallback: reject purely numeric values if no format matched
        return 'Must be a valid date format (not just numbers)'
    
    # Only try common formats if format is "Any" or not specified
    if fmt_upper in {'', 'ANY'}:
        # Try ISO8601 and common formats
        try:
            _ = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return None  # Valid!
        except ValueError:
            pass
        
        # List of common formats to try
        common_formats = [
            '%Y-%m-%d',         # 2024-09-18
            '%Y/%m/%d',         # 2024/09/18
            '%Y.%m.%d',         # 2024.09.18
            '%m/%d/%Y',         # 09/18/2024
            '%d/%m/%Y',         # 18/09/2024
            '%Y-%m-%d %H:%M:%S',  # With time
        ]
        for fmt in common_formats:
            try:
                datetime.strptime(value, fmt)
                return None  # Success, found a matching format
            except ValueError:
                continue  # Try the next format
        
        # If no common format works, it's likely invalid
        return 'Must be a valid date format'
    
    # If we get here with a specific format, the date didn't match the required format
    if fmt_upper and fmt_upper != 'ANY':
        return f'Must be in {format_rule} format'
    
    return None


def validate_boolean(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """
    Boolean validator with support for specific true/false pairs.
    Rule properties: `template` or `format` ('any' | 'true/false' | 'yes/no' | '1/0' | 'on/off').
    
    IMPORTANT: Defaults to 'any' format to accept all common boolean representations.
    This must be kept in sync with services/validation_service.py to avoid
    validation inconsistencies during re-validation operations.
    """
    if rules is None:
        rules = {}
    
    # Use template as primary key (matching validation_service.py), fallback to validation_format or format
    template = rules.get('template') or rules.get('validation_format') or rules.get('format', 'any')
    
    # Normalize template format (handle variations in case and separators)
    template_lower = template.lower()
    if template_lower in ['true/false', 'true_false']:
        template = 'true/false'
    elif template_lower in ['yes/no', 'yes_no']:
        template = 'yes/no'
    elif template_lower in ['1/0', '1_0']:
        template = '1/0'
    elif template_lower in ['on/off', 'on_off']:
        template = 'on/off'
    elif template_lower != 'any':
        # Unknown template, log warning and use "any"
        logger.warning(f'Unknown boolean template \'{template}\', using \'any\'')
        template = 'any'
    
    val = value.lower()
    logger.debug(f'[validate_boolean] value: {value}, template: {template}')
    
    # Map of template names to allowed values - must match services/validation_service.py
    valid_values_map = {
        'any': ['true', 'false', 'yes', 'no', '1', '0', 'on', 'off', 't', 'f', 'y', 'n'],
        'true/false': ['true', 'false', 't', 'f'],
        'yes/no': ['yes', 'no', 'y', 'n'],
        '1/0': ['1', '0'],  # Keep strict - only 1 and 0
        'on/off': ['on', 'off'],  # Keep strict - only on and off
    }
    
    allowed_values = valid_values_map.get(template, [])
    if not allowed_values:
        # If unknown template, fall back to "any"
        logger.warning(f'Unknown boolean template \'{template}\', falling back to \'any\'')
        allowed_values = valid_values_map['any']
    
    if val not in allowed_values:
        # Format the template name for display
        display_template = template.replace('_', '/') if template != 'any' else 'any of: true/false, yes/no, 1/0, on/off'
        return f'Must be a valid boolean value ({display_template})'
    
    return None


def validate_email(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """Email validator using regex pattern."""
    email_regex = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    if not email_regex.match(value):
        return 'Must be a valid email address'
    return None


def validate_phone(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """Phone number validator."""
    phone_regex = re.compile(r'^[\+]?[ -\d\s\-\(\)]{7,15}$')
    if not phone_regex.match(value):
        return 'Must be a valid phone number'
    return None


def validate_url(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """URL validator."""
    try:
        result = urlparse(value)
        if not all([result.scheme, result.netloc]):
            return 'Must be a valid URL'
        return None
    except Exception:
        return 'Must be a valid URL'


def validate_string(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """String validator with length constraints."""
    if rules is None:
        rules = {}
    
    max_length = rules.get('max_length')
    min_length = rules.get('min_length')
    
    if max_length and len(value) > max_length:
        return f'Exceeds maximum length of {max_length} characters'
    
    if min_length and len(value) < min_length:
        return f'Must be at least {min_length} characters'
    
    return None


def validate_enum(value: str, rules: Dict[str, Any] = None) -> Optional[str]:
    """Enum/select validator."""
    if rules is None:
        rules = {}
    
    options = rules.get('options', [])
    if options:
        options_lower = [opt.lower() for opt in options]
        if value.lower() not in options_lower:
            return f'Must be one of: {", ".join(options)}'
    
    return None


# The main validation map
validators = {
    'number': validate_number,
    'integer': validate_number,  # Add integer as a distinct type
    'date': validate_date,
    'datetime': validate_date,
    'email': validate_email,
    'phone': validate_phone,
    'url': validate_url,
    'boolean': validate_boolean,
    'string': validate_string,
    'select': validate_enum,
    'enum': validate_enum,
}


def validate_field(value: Any, field_config: Dict[str, Any]) -> Optional[str]:
    """
    Main validation function that mimics the TypeScript validateField function.
    
    Args:
        value: The value to validate
        field_config: Field configuration containing type, required, validation rules, etc.
    
    Returns:
        Error message string if validation fails, None if validation passes
    """
    field_name = field_config.get('name', 'Field')
    field_type = field_config.get('type')

    # Entry log for traceability
    logger.info("Enter validation: field=%s, type=%s, required=%s, raw_value=%r", field_name, field_type, field_config.get('required'), value)

    # 1. Check for required
    if field_config.get('required') and (not value or str(value).strip() == ''):
        logger.warning("Required check failed for field '%s' - value missing", field_name)
        return f'{field_name} is required'

    # Skip further validation if the value is empty and not required
    if not value or str(value).strip() == '':
        logger.debug("Skipping validation for empty non-required field '%s'", field_name)
        return None

    # 2. Get the specific validator function
    validator_fn = validators.get(field_type)

    if not validator_fn:
        logger.debug("No validator registered for type '%s' (field: '%s')", field_type, field_name)
        return None  # No validation for this type

    # Gather validation rules from multiple places for backward compatibility
    # Prefer top-level `extra_rules` (API shape), then `validation`, and merge
    validation_rules = {}

    # If field_config has top-level extra_rules, merge them first
    top_extra = field_config.get('extra_rules')
    # Log presence and type of top-level extra_rules for debugging
    if top_extra and isinstance(top_extra, dict):
        validation_rules.update(top_extra)
    elif top_extra is not None and not isinstance(top_extra, dict):
        logger.warning("top-level 'extra_rules' for '%s' is present but not a dict (type=%s)", field_name, type(top_extra).__name__)

    # Merge legacy `validation` object if present
    legacy_validation = field_config.get('validation') or {}
    # Log legacy validation object for debugging
    logger.info("legacy 'validation' for '%s': %r", field_name, legacy_validation)
    if isinstance(legacy_validation, dict):
        # If legacy_validation contains nested extra_rules, merge them too
        nested_extra = legacy_validation.get('extra_rules')
        if isinstance(nested_extra, dict):
            validation_rules.update(nested_extra)

        # Merge the rest of legacy_validation (without the nested extra_rules key)
        for k, v in legacy_validation.items():
            if k == 'extra_rules':
                continue
            # Do not overwrite keys already provided by top-level extra_rules
            if k not in validation_rules:
                validation_rules[k] = v

    # Debug: show merged rules used for validation
    logger.info("Using merged validation rules for field '%s': %s", field_name, validation_rules)

    # Call validator and log the outcome
    try:
        # Pass field_type for number/integer distinction
        if field_type in ['number', 'integer']:
            result = validator_fn(str(value).strip(), validation_rules, field_type)
        else:
            result = validator_fn(str(value).strip(), validation_rules)
    except Exception as exc:  # Defensive: log unexpected validator exceptions
        logger.exception("Validator for field '%s' raised an exception: %s", field_name, exc)
        return 'Validation failed due to internal error'
    if result:
        logger.info("Validation FAILED for field '%s': %s", field_name, result)
    else:
        logger.debug("Validation passed for field '%s'", field_name)

    return result


def validate_pattern(value: str, pattern: Optional[str] = None) -> Optional[str]:
    """
    Pattern validator (optional, can be used in addition to type validation).
    
    Args:
        value: The value to validate
        pattern: Regex pattern string
    
    Returns:
        Error message string if validation fails, None if validation passes
    """
    if not pattern:
        return None
    
    try:
        regex = re.compile(pattern)
        if not regex.match(value):
            return 'Does not match required pattern'
    except re.error:
        return 'Invalid pattern'
    
    return None
