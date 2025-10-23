"""
Field validation service for import data validation.

This service provides comprehensive field validation capabilities that mirror
the frontend validation logic to ensure consistency across the application.
"""
import re
import math
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Union, Tuple
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


class ValidationService:
    """Service for validating field data according to field type specifications."""

    @staticmethod
    def validate_required(value: Any, field_name: str) -> Optional[str]:
        """Validate that a required field has a value."""
        if value is None or str(value).strip() == "":
            return f"{field_name} is required"
        return None

    @staticmethod
    def validate_string_length(value: str, field_name: str, min_length: Optional[int] = None, max_length: Optional[int] = None) -> Optional[str]:
        """Validate string length constraints."""
        if not isinstance(value, str):
            value = str(value)
        
        length = len(value)
        
        if min_length is not None and length < min_length:
            return f"{field_name} must be at least {min_length} characters"
        
        if max_length is not None and length > max_length:
            return f"{field_name} exceeds maximum length of {max_length} characters"
        
        return None

    @staticmethod
    def validate_number(value: Any, field_name: str, field_type: str = "number", 
                       min_value: Optional[float] = None, max_value: Optional[float] = None,
                       extra_rules: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Validate numeric fields with type and range checking."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        
        # Check for common non-numeric patterns
        if "@" in str_value:
            return f"{field_name} appears to contain an email address but should be a number"
        
        if str_value.startswith(("http://", "https://")):
            return f"{field_name} appears to contain a URL but should be a number"
        
        try:
            num_value = float(str_value)
            # Explicitly check for NaN values
            if math.isnan(num_value):
                return f"{field_name} must be a valid number"
        except ValueError:
            return f"{field_name} must be a valid number"
        
        # Integer validation
        if field_type == "integer" and not num_value.is_integer():
            return f"{field_name} must be a whole number"
        
        # Min/Max validation
        if min_value is not None and num_value < min_value:
            return f"{field_name} must be at least {min_value}"
        
        if max_value is not None and num_value > max_value:
            return f"{field_name} must be at most {max_value}"
        
        # Positive/Negative validation from extra_rules
        if extra_rules:
            logger.debug(f"Validating number '{value}' for field '{field_name}' with extra_rules: {extra_rules}")
            if extra_rules.get('sign'):
                sign_rule = extra_rules['sign'].lower()
                logger.debug(f"Sign rule for '{field_name}': {sign_rule}, value: {num_value}")
                if sign_rule == "positive" and num_value <= 0:
                    return f"{field_name} must be a positive number"
                elif sign_rule == "negative" and num_value >= 0:
                    return f"{field_name} must be a negative number"
    
        
        return None

    @staticmethod
    def validate_email(value: Any, field_name: str) -> Optional[str]:
        """Validate email address format."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        email_regex = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
        
        if not email_regex.match(str_value):
            return f"{field_name} must be a valid email address"
        
        return None

    @staticmethod
    def validate_phone(value: Any, field_name: str) -> Optional[str]:
        """Validate phone number format."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        phone_regex = re.compile(r'^[\+]?[\d\s\-\(\)]{7,15}$')
        
        if not phone_regex.match(str_value):
            return f"{field_name} must be a valid phone number"
        
        return None

    @staticmethod
    def validate_url(value: Any, field_name: str) -> Optional[str]:
        """Validate URL format."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        
        try:
            result = urlparse(str_value)
            if not all([result.scheme, result.netloc]):
                raise ValueError("Invalid URL")
        except (ValueError, Exception):
            return f"{field_name} must be a valid URL"
        
        return None

    @staticmethod
    def validate_date(value: Any, field_name: str, date_format: Optional[str] = None) -> Optional[str]:
        """Validate date format.
        
        Improvements:
        - Check specific format FIRST if provided before trying common formats
        - Accept common numeric-only dates like YYYYMMDD when format is Any
        - Support strict 'YYYY-MM-DD' and dot formats like 'YYYY.MM.DD'
        - Treat 'Any' case-insensitively
        """
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        
        # Case-insensitive handling for 'Any'
        fmt = (date_format or "").strip()
        fmt_upper = fmt.upper()
        
        # IMPORTANT: Check specific format FIRST if provided
        if fmt_upper and fmt_upper != "ANY":
            if fmt_upper == "MM/DD/YYYY":
                # Must match MM/DD/YYYY format with any delimiter (/, -, .)
                match = re.match(r'^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{4})$', str_value)
                if not match:
                    return f"{field_name} must be in MM/DD/YYYY format"
                try:
                    # Extract the parts and validate as a date
                    month, day, year = match.groups()
                    datetime.strptime(f"{month}/{day}/{year}", "%m/%d/%Y")
                    return None  # Valid!
                except ValueError:
                    return f"{field_name} must be a valid date in MM/DD/YYYY format"
            elif fmt_upper == "DD/MM/YYYY":
                # Must match DD/MM/YYYY format with any delimiter (/, -, .)
                match = re.match(r'^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{4})$', str_value)
                if not match:
                    return f"{field_name} must be in DD/MM/YYYY format"
                try:
                    # Extract the parts and validate as a date
                    day, month, year = match.groups()
                    datetime.strptime(f"{day}/{month}/{year}", "%d/%m/%Y")
                    return None  # Valid!
                except ValueError:
                    return f"{field_name} must be a valid date in DD/MM/YYYY format"
            elif fmt_upper == "YYYY/MM/DD":
                # Must match YYYY/MM/DD format with any delimiter (/, -, .)
                match = re.match(r'^(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})$', str_value)
                if not match:
                    return f"{field_name} must be in YYYY/MM/DD format"
                try:
                    # Extract the parts and validate as a date
                    year, month, day = match.groups()
                    datetime.strptime(f"{year}/{month}/{day}", "%Y/%m/%d")
                    return None  # Valid!
                except ValueError:
                    return f"{field_name} must be a valid date in YYYY/MM/DD format"
            elif fmt_upper == "YYYY-MM-DD":
                # Must match YYYY-MM-DD format with any delimiter (/, -, .)
                match = re.match(r'^(\d{4})[-/\.](\d{1,2})[-/\.](\d{1,2})$', str_value)
                if not match:
                    return f"{field_name} must be in YYYY-MM-DD format"
                try:
                    # Extract the parts and validate as a date
                    year, month, day = match.groups()
                    datetime.strptime(f"{year}-{month}-{day}", "%Y-%m-%d")
                    return None  # Valid!
                except ValueError:
                    return f"{field_name} must be a valid date in YYYY-MM-DD format"
            # If specific format is set but doesn't match any known format
            else:
                logger.warning(f"Unknown date format '{fmt_upper}' specified for field {field_name}")
        
        # Handle numeric-only values for "Any" format
        if re.match(r'^\d+$', str_value):
            # Allow common compact formats when format is ANY or unspecified
            if fmt_upper in {"", "ANY"}:
                # Try YYYYMMDD
                if len(str_value) == 8:
                    try:
                        datetime.strptime(str_value, "%Y%m%d")
                        return None
                    except ValueError:
                        pass
                # Try YYYYMM
                if len(str_value) == 6:
                    try:
                        datetime.strptime(str_value + "01", "%Y%m%d")
                        return None
                    except ValueError:
                        pass
            # Fallback: reject purely numeric values if no format matched
            return f"{field_name} must be a valid date format (not just numbers)"
        
        # Only try common formats if format is "Any" or not specified
        if fmt_upper in {"", "ANY"}:
            # Try ISO8601 and common formats
            try:
                _ = datetime.fromisoformat(str_value.replace('Z', '+00:00'))
                return None  # Valid!
            except ValueError:
                pass
            
            # Try common date formats
            common_formats = [
                "%Y-%m-%d",      # 2024-09-18
                "%Y/%m/%d",      # 2024/09/18
                "%Y.%m.%d",      # 2024.09.18
                "%m/%d/%Y",      # 09/18/2024
                "%d/%m/%Y",      # 18/09/2024
                "%Y-%m-%d %H:%M:%S",  # With time
            ]
            
            for fmt_try in common_formats:
                try:
                    _ = datetime.strptime(str_value, fmt_try)
                    return None  # Valid!
                except ValueError:
                    continue
            
            # If none of the formats matched
            return f"{field_name} must be a valid date format"
        
        # If we get here with a specific format, the date didn't match the required format
        if fmt_upper and fmt_upper != "ANY":
            return f"{field_name} must be in {fmt} format"
        
        return None

    @staticmethod
    def validate_boolean(value: Any, field_name: str, template: str = "any") -> Optional[str]:
        """Validate boolean values with different templates.
        
        Defaults to 'any' to maintain consistency with utils/validator.py and avoid
        spurious validation errors when extra_rules.template is not specified.
        This ensures values like '0', '1' remain valid during re-validation.
        """
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip().lower()
        
        # Map of template names to allowed values - must match utils/validator.py
        valid_values_map = {
            "any": ["true", "false", "yes", "no", "1", "0", "on", "off", "t", "f", "y", "n"],
            "true/false": ["true", "false", "t", "f"],
            "true_false": ["true", "false", "t", "f"],  # Support underscore variant
            "yes/no": ["yes", "no", "y", "n"],
            "yes_no": ["yes", "no", "y", "n"],  # Support underscore variant
            "1/0": ["1", "0"],  # Keep strict - only 1 and 0
            "1_0": ["1", "0"],  # Support underscore variant  - only 1 and 0
            "on/off": ["on", "off"],  # Keep strict - only on and off
            "on_off": ["on", "off"]  # Support underscore variant - only on and off
        }
        
        valid_values = valid_values_map.get(template, [])
        if not valid_values:
            # If unknown template, fall back to "any"
            logger.warning(f"Unknown boolean template '{template}', falling back to 'any'")
            valid_values = valid_values_map["any"]
        
        if str_value not in valid_values:
            # Format the template name for display
            display_template = template.replace("_", "/") if template != "any" else "any of: true/false, yes/no, 1/0, on/off"
            return f"{field_name} must be a valid boolean value ({display_template})"
        
        return None

    @staticmethod
    def validate_select(value: Any, field_name: str, options: List[str]) -> Optional[str]:
        """Validate select/enum field against allowed options."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        
        # Case-insensitive comparison
        if str_value.lower() not in [opt.lower() for opt in options]:
            return f"{field_name} must be one of: {', '.join(options)}"
        
        return None

    @staticmethod
    def validate_pattern(value: Any, field_name: str, pattern: str) -> Optional[str]:
        """Validate field against a regex pattern."""
        if value == "" or value is None:
            return None
        
        str_value = str(value).strip()
        
        try:
            if not re.match(pattern, str_value):
                return f"{field_name} does not match required pattern"
        except re.error:
            logger.warning(f"Invalid regex pattern for field {field_name}: {pattern}")
            return None
        
        return None

    @classmethod
    def validate_field(cls, value: Any, field_config: Dict[str, Any]) -> Optional[str]:
        """
        Validate a single field value against its configuration.
        
        Args:
            value: The value to validate
            field_config: Field configuration containing type, validation rules, etc.
            
        Returns:
            Error message if validation fails, None if valid
        """
        field_name = field_config.get("name", "Field")
        field_type = field_config.get("type", "").lower()
        required = field_config.get("required", False)
        
        # Required field validation
        if required:
            error = cls.validate_required(value, field_name)
            if error:
                return error
        
        # If field is not required and empty, skip other validations
        if not required and (value == "" or value is None):
            return None
        
        # Get extra_rules from field config (with backward compatibility)
        extra_rules = field_config.get("extra_rules", {})
        if not extra_rules:
            # Backward compatibility: convert validation_format and template to extra_rules
            extra_rules = {}
            if field_config.get("validation_format"):
                if field_type in ["number", "numeric", "integer"]:
                    extra_rules["sign"] = field_config["validation_format"]
                elif field_type in ["date", "datetime"]:
                    extra_rules["format"] = field_config["validation_format"]
                elif field_type == "custom_regex":
                    extra_rules["pattern"] = field_config["validation_format"]
                elif field_type == "select":
                    extra_rules["options"] = field_config["validation_format"]
            if field_config.get("template"):
                if field_type in ["boolean", "bool"]:
                    extra_rules["template"] = field_config["template"]
        
        # Debug logging for extra_rules
        if extra_rules:
            logger.debug(f"Field '{field_name}' (type: {field_type}) has extra_rules: {extra_rules}")
        
        # Type-specific validation
        if field_type in ["number", "numeric", "integer"]:
            return cls.validate_number(
                value, field_name, field_type,
                field_config.get("min_value"),
                field_config.get("max_value"),
                extra_rules  # Pass extra_rules for positive/negative rules
            )
        
        elif field_type == "email":
            return cls.validate_email(value, field_name)
        
        elif field_type == "phone":
            return cls.validate_phone(value, field_name)
        
        elif field_type == "url":
            return cls.validate_url(value, field_name)
        
        elif field_type in ["date", "datetime"]:
            # Use date format from extra_rules or validation_format
            date_format = extra_rules.get("format") or field_config.get("validation_format")
            
            # Log date validation details for debugging
            if date_format:
                logger.debug(f"Validating date field '{field_name}' with format: {date_format}")
            else:
                logger.debug(f"Validating date field '{field_name}' with format: Any (no specific format)")
            
            return cls.validate_date(value, field_name, date_format)
        
        elif field_type in ["boolean", "bool"]:
            # Use boolean template from extra_rules, default to 'any' for consistency
            # This ensures values like '0', '1' are accepted when no specific template is set
            boolean_template = extra_rules.get("template", "any") 
            
            # Normalize template format (handle variations in case and separators)
            template_lower = boolean_template.lower()
            if template_lower in ["true/false", "true_false"]:
                boolean_template = "true/false"
            elif template_lower in ["yes/no", "yes_no"]:
                boolean_template = "yes/no"
            elif template_lower in ["1/0", "1_0"]:
                boolean_template = "1/0"
            elif template_lower in ["on/off", "on_off"]:
                boolean_template = "on/off"
            elif template_lower != "any":
                # Unknown template, log warning and use "any"
                logger.warning(f"Unknown boolean template '{boolean_template}' for field {field_name}, using 'any'")
                boolean_template = "any"
                
            return cls.validate_boolean(value, field_name, boolean_template)
        
        elif field_type in ["select", "enum"]:
            # Use options from extra_rules
            options_str = extra_rules.get("options", "")
            if isinstance(options_str, str):
                options = [opt.strip() for opt in options_str.split(",") if opt.strip()]
            else:
                options = options_str if isinstance(options_str, list) else []
            
            if not options:
                # Fallback to field_config options
                options = field_config.get("options", [])
            
            if options:
                return cls.validate_select(value, field_name, options)
        
        # String length validation for text fields
        if field_type in ["text", "string", ""] or not field_type:
            return cls.validate_string_length(
                str(value) if value is not None else "",
                field_name,
                field_config.get("min_length"),
                field_config.get("max_length")
            )
        
        # Pattern validation
        pattern = field_config.get("pattern")
        if pattern:
            return cls.validate_pattern(value, field_name, pattern)
        
        return None

    @classmethod
    def validate_single_cell(cls, cell_value: str, field_config: Dict[str, Any], row_index: int, col_index: int) -> Optional[Dict[str, Any]]:
        """
        Validate a single cell and return conflict info if validation fails.
        
        Args:
            cell_value: The value to validate
            field_config: Field configuration for this column
            row_index: Row index of the cell
            col_index: Column index of the cell
            
        Returns:
            Conflict dict if validation fails, None if valid
        """
        field_name = field_config.get("name", f"Column_{col_index}")
        
        # Validate the cell using existing validation logic
        error = cls.validate_field(cell_value, field_config)
        
        if error:
            return {
                "row": row_index,
                "col": col_index,
                "field": field_name,
                "error": error,
                "value": cell_value
            }
        
        return None

    @classmethod
    def validate_conflicts(cls, data: List[List[str]], headers: List[str], field_configs: List[Dict[str, Any]], 
                          conflicts: List[Dict[str, Any]], column_mapping: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """
        Re-validate previously conflicted cells to check if they've been resolved.
        
        This function handles both API and portal import conflict formats:
        - API format: {"row": 1, "column": "field_name", "message": "error"}
        - Portal format: {"row": 0, "col": 2, "field": "field_name", "error": "error"}
        
        Args:
            data: 2D array of cell values
            headers: Column headers (may be CSV column names for API imports)
            field_configs: Field configuration for each column
            conflicts: Original conflicts to re-validate
            column_mapping: Optional mapping from field names to CSV column names (for API imports)
            
        Returns:
            Updated list of conflicts (only unresolved ones)
        """
        remaining_conflicts = []
        
        logger.info(f"Validating {len(conflicts)} conflicts against {len(data)} rows and {len(headers)} headers")
        
        # Create header to config mapping
        header_to_config = {}
        for config in field_configs:
            config_name = config.get("name", "")
            if config_name in headers:
                header_to_config[config_name] = config
        
        logger.info(f"Created field config mapping for {len(header_to_config)} fields")
        logger.debug(f"Available field configs: {list(header_to_config.keys())}")
        logger.debug(f"Available headers: {headers}")
        
        for i, conflict in enumerate(conflicts):
            # Handle both API and portal conflict formats
            row_idx = conflict.get("row", -1)
            col_idx = conflict.get("col", -1)  # Portal format
            field_name = conflict.get("field", "") or conflict.get("column", "")  # API uses "column", portal uses "field"
            
            logger.debug(f"Validating conflict {i+1}/{len(conflicts)}: row={row_idx}, col={col_idx}, field={field_name}")
            
            # For API imports, we need to derive col_idx from field_name
            if col_idx < 0 and field_name:
                # First try direct lookup in headers
                try:
                    col_idx = headers.index(field_name)
                    logger.debug(f"Found field '{field_name}' directly in headers at index {col_idx}")
                except ValueError:
                    # If not found and we have column mapping, try to find the CSV column name
                    if column_mapping and field_name in column_mapping:
                        csv_column = column_mapping[field_name]
                        try:
                            col_idx = headers.index(csv_column)
                            logger.debug(f"Found field '{field_name}' mapped to CSV column '{csv_column}' at index {col_idx}")
                        except ValueError:
                            logger.warning(f"CSV column '{csv_column}' (mapped from field '{field_name}') not found in headers for conflict {i+1}, skipping")
                            continue
                    else:
                        logger.warning(f"Field '{field_name}' not found in headers and no mapping available for conflict {i+1}, skipping")
                        continue
            
            # Validate row index
            # For API conflicts, row is 1-based, convert to 0-based for data array access
            data_row_idx = row_idx - 1 if row_idx > 0 else row_idx
            if data_row_idx < 0 or data_row_idx >= len(data):
                logger.warning(f"Invalid row index {row_idx} (data_row_idx={data_row_idx}) for conflict {i+1}, skipping")
                continue
                
            # Validate column index
            if col_idx < 0 or col_idx >= len(headers):
                logger.warning(f"Invalid column index {col_idx} for conflict {i+1}, skipping")
                continue
            
            # Get current value and field config
            row_data = data[data_row_idx] if data_row_idx < len(data) else []
            current_value = row_data[col_idx] if col_idx < len(row_data) else ""
            field_config = header_to_config.get(field_name)
            
            # If field config not found by field name and we have column mapping, try the CSV column name
            if not field_config and column_mapping and field_name in column_mapping:
                csv_column = column_mapping[field_name]
                field_config = header_to_config.get(csv_column)
                if field_config:
                    logger.debug(f"Found field config for '{field_name}' using CSV column '{csv_column}'")
            
            if not field_config:
                logger.warning(f"No field config found for field '{field_name}' in conflict {i+1}, keeping original conflict")
                remaining_conflicts.append(conflict)
                continue
            
            # Re-validate the field
            try:
                validation_error = cls.validate_field(current_value, field_config)
                
                if validation_error:
                    # Still has validation error, update the conflict
                    updated_conflict = conflict.copy()
                    updated_conflict["error"] = validation_error
                    updated_conflict["value"] = current_value
                    remaining_conflicts.append(updated_conflict)
                    logger.debug(f"Conflict {i+1} still invalid: {validation_error}")
                else:
                    logger.debug(f"Conflict {i+1} resolved: '{current_value}' is now valid")
                # If no validation error, the conflict is resolved (don't add to remaining)
            except Exception as e:
                logger.error(f"Error validating conflict {i+1}: {str(e)}")
                # On validation error, keep the original conflict
                remaining_conflicts.append(conflict)
        
        logger.info(f"Validation complete: {len(remaining_conflicts)} conflicts remaining out of {len(conflicts)} original")
        return remaining_conflicts


# Create a global instance
validation_service = ValidationService()
