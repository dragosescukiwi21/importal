import React, { useState, useEffect, useMemo, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Flex, Text, Box, Switch, Tooltip, Input, Alert, AlertIcon, AlertTitle, AlertDescription } from '@chakra-ui/react';
import { ValidationProps } from './types';
import style from './style/Validation.module.scss';


// Validation component for checking imported data
export default function Validation({
  template,
  data: fileData,
  columnMapping,
  selectedHeaderRow,
  onSuccess,
  onCancel,
  isSubmitting,
  backendUrl,
  filterInvalidRows,
  disableOnInvalidRows,
}: ValidationProps) {
  const { t } = useTranslation();

  
  // Enhanced state setup with conflict detection
  const [editedValues, setEditedValues] = useState<Record<number, Record<number, any>>>({});
  const [errors, setErrors] = useState<Array<{rowIndex: number, columnIndex: number, message: string, type?: 'validation' | 'conflict'}>>([]);
  const [conflicts, setConflicts] = useState<Array<{rowIndex: number, columnIndex: number, message: string, conflictType: string}>>([]);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [isCheckingConflicts, setIsCheckingConflicts] = useState(false);
  
  // Extract header and data rows
  const headerRowIndex = selectedHeaderRow || 0;
  const headerRow = fileData.rows[headerRowIndex];
  const dataRows = fileData.rows.slice(headerRowIndex + 1);
  
  // Get included columns from mapping
  const includedColumns = useMemo(() => {
    return Object.entries(columnMapping)
      .filter(([_, mapping]) => mapping.include)
      .map(([index]) => parseInt(index));
  }, [columnMapping]);
  
  // Get column headers
  const headers = useMemo(() => {
    return includedColumns.map(colIdx => String(headerRow.values[colIdx]));
  }, [includedColumns, headerRow]);
  
  // Validate data - use a ref to track if we need to validate
  const shouldValidateRef = React.useRef(true);
  
  // Create a stable version of editedValues for dependency tracking
  const editedValuesRef = React.useRef(editedValues);
  React.useEffect(() => {
    editedValuesRef.current = editedValues;
    shouldValidateRef.current = true;
  }, [editedValues]);

  // Function to check for database conflicts
  const checkDatabaseConflicts = React.useCallback(async () => {
    if (!backendUrl || !template) return;
    
    setIsCheckingConflicts(true);
    try {
      // Prepare data for conflict checking
      const recordsToCheck = dataRows.map((row, rowIdx) => {
        const record: any = {};
        Object.entries(columnMapping).forEach(([colIndexStr, mapping]) => {
          if (!mapping.include) return;
          
          const colIdx = parseInt(colIndexStr);
          const originalValue = row.values[colIdx];
          const editedValue = editedValuesRef.current[rowIdx]?.[colIdx];
          const value = editedValue !== undefined ? editedValue : originalValue;
          
          record[mapping.key] = value;
        });
        record._rowIndex = rowIdx;
        return record;
      });

      // Check for conflicts with existing data
      const response = await fetch(`${backendUrl}/api/conflicts/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          template_id: (template as any).id || 'default_template',
          records: recordsToCheck
        })
      });

      if (response.ok) {
        const conflictData = await response.json();
        const newConflicts: Array<{rowIndex: number, columnIndex: number, message: string, conflictType: string}> = [];

        conflictData.conflicts?.forEach((conflict: any) => {
          const rowIdx = conflict.rowIndex;
          const displayRowIndex = rowIdx + headerRowIndex + 1;
          
          // Find which columns are causing conflicts
          conflict.conflictFields?.forEach((field: string) => {
            // Find the column index for this field
            const colEntry = Object.entries(columnMapping).find(([_, mapping]) => 
              mapping.include && mapping.key === field
            );
            
            if (colEntry) {
              const colIdx = parseInt(colEntry[0]);
              newConflicts.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `Duplicate ${field}: ${conflict.conflictValue || 'value already exists'}`,
                conflictType: conflict.type || 'duplicate'
              });
            }
          });
        });

        setConflicts(newConflicts);
      }
    } catch (error) {
      console.error('Error checking database conflicts:', error);
    } finally {
      setIsCheckingConflicts(false);
    }
  }, [backendUrl, template, dataRows, columnMapping, headerRowIndex]);

  // Check for conflicts when data changes
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      checkDatabaseConflicts();
    }, 1000); // Debounce conflict checking

    return () => clearTimeout(timeoutId);
  }, [checkDatabaseConflicts]);
  
  // Check for mapping mismatches
  React.useEffect(() => {
    // Check if mappings match template fields
    const templateKeys = template.columns.map(col => col.key);
    const mismatches = Object.entries(columnMapping).filter(([_, mapping]) => {
      if (!mapping.include) return false;
      return !templateKeys.includes(mapping.key);
    });
    
    if (mismatches.length > 0) {

    }
  }, [template, columnMapping]);

  // Enhanced validation logic with comprehensive CSV validation
  const validateData = React.useCallback(() => {
    if (!shouldValidateRef.current) return;
    
    const newErrors: Array<{rowIndex: number, columnIndex: number, message: string, type?: 'validation' | 'conflict'}> = [];
    
    // Track unique values for duplicate detection within the CSV
    const uniqueValueTrackers: Record<string, Map<string, number[]>> = {};
    
    // Initialize unique value trackers for fields that should be unique
    template.columns.forEach(col => {
      const fieldAny = col as any;
      if (col.key && (fieldAny.unique || fieldAny.is_unique || col.key === 'id' || col.key.includes('email'))) {
        uniqueValueTrackers[col.key] = new Map();
      }
    });
    
    // For each row in the data
    dataRows.forEach((row, rowIdx) => {
      const displayRowIndex = rowIdx + headerRowIndex + 1;
      
      // Check for completely empty rows
      const hasAnyValue = Object.entries(columnMapping).some(([colIndexStr, mapping]) => {
        if (!mapping.include) return false;
        const colIdx = parseInt(colIndexStr);
        const originalValue = row.values[colIdx];
        const editedValue = editedValuesRef.current[rowIdx]?.[colIdx];
        const value = editedValue !== undefined ? editedValue : originalValue;
        return value !== '' && value !== null && value !== undefined;
      });
      
      if (!hasAnyValue) {
        // Mark entire row as empty
        Object.entries(columnMapping).forEach(([colIndexStr, mapping]) => {
          if (!mapping.include) return;
          const colIdx = parseInt(colIndexStr);
          newErrors.push({
            rowIndex: displayRowIndex,
            columnIndex: colIdx,
            message: 'Empty row - all fields are blank',
            type: 'validation'
          });
        });
        return;
      }
      
      // For each column mapping
      Object.entries(columnMapping).forEach(([colIndexStr, mapping]) => {
        if (!mapping.include) return;
        
        // The column index in the data
        const colIdx = parseInt(colIndexStr);
        if (isNaN(colIdx)) return;
        
        // The key in the template
        const templateField = mapping.key;
        
        // Find the corresponding template field
        const field = template.columns.find(col => col.key === templateField);
        if (!field) {
          newErrors.push({
            rowIndex: displayRowIndex,
            columnIndex: colIdx,
            message: `Field mapping error: ${templateField} not found in template`,
            type: 'validation'
          });
          return;
        }
        
        // Get the value (use edited value if available)
        const originalValue = row.values[colIdx];
        const editedValue = editedValuesRef.current[rowIdx]?.[colIdx];
        const value = editedValue !== undefined ? editedValue : originalValue;
        
        // Access field properties safely
        const fieldAny = field as any;
        const fieldType = fieldAny.type || fieldAny.data_type || '';
        const isRequired = field.required || fieldAny.required || false;
        const isUnique = fieldAny.unique || fieldAny.is_unique || false;
        
        // Track unique values within CSV
        if ((isUnique || (field.key && uniqueValueTrackers[field.key])) && field.key) {
          const strValue = String(value || '').trim();
          if (strValue !== '') {
            const tracker = uniqueValueTrackers[field.key];
            if (tracker.has(strValue)) {
              const existingRows = tracker.get(strValue) || [];
              existingRows.push(displayRowIndex);
              tracker.set(strValue, existingRows);
              
              // Add error for duplicate within CSV
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `Duplicate ${field.name}: "${strValue}" already exists in row(s) ${existingRows.slice(0, -1).join(', ')}`,
                type: 'validation'
              });
            } else {
              tracker.set(strValue, [displayRowIndex]);
            }
          }
        }
        
        // Skip validation if value is empty and not required
        if ((value === '' || value === null || value === undefined) && !isRequired) {
          return;
        }
        
        // Required field validation
        if (isRequired && (value === '' || value === null || value === undefined)) {
          newErrors.push({
            rowIndex: displayRowIndex,
            columnIndex: colIdx,
            message: `${field.name} is required`,
            type: 'validation'
          });
          return;
        }
        
        // String length validation
        const maxLength = fieldAny.max_length || fieldAny.maxLength;
        const minLength = fieldAny.min_length || fieldAny.minLength;
        if (typeof value === 'string' && value.length > 0) {
          if (maxLength && value.length > maxLength) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} exceeds maximum length of ${maxLength} characters`,
              type: 'validation'
            });
          }
          if (minLength && value.length < minLength) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be at least ${minLength} characters`,
              type: 'validation'
            });
          }
        }
        
        // Number validation with range checking
        if ((fieldType === 'number' || fieldType === 'numeric' || fieldType === 'integer') && value !== '') {
          const numValue = Number(value);
          
          // Check if value contains common non-numeric patterns
          const emailPattern = /@/;
          const urlPattern = /^https?:\/\//;
          
          if (emailPattern.test(String(value))) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} appears to contain an email address but should be a number`,
              type: 'validation'
            });
          } else if (urlPattern.test(String(value))) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} appears to contain a URL but should be a number`,
              type: 'validation'
            });
          } else if (isNaN(numValue)) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid number`,
              type: 'validation'
            });
          } else {
            // Check integer validation
            if (fieldType === 'integer' && !Number.isInteger(numValue)) {
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `${field.name} must be a whole number`,
                type: 'validation'
              });
            }
            
            // Check range validation
            const minValue = fieldAny.min_value || fieldAny.minValue;
            const maxValue = fieldAny.max_value || fieldAny.maxValue;
            if (minValue !== undefined && numValue < minValue) {
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `${field.name} must be at least ${minValue}`,
                type: 'validation'
              });
            }
            if (maxValue !== undefined && numValue > maxValue) {
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `${field.name} must not exceed ${maxValue}`,
                type: 'validation'
              });
            }
          }
        }
        
        // Boolean validation with template support
        if ((fieldType === 'boolean' || fieldType === 'bool') && value !== '') {
          const template = fieldAny.template || fieldAny.boolean_template || 'true/false';
          let isValid = false;
          
          if (template === 'true/false') {
            isValid = ['true', 'false', true, false].includes(String(value).toLowerCase());
          } else if (template === 'yes/no') {
            isValid = ['yes', 'no', 'Yes', 'No', 'YES', 'NO'].includes(String(value).toLowerCase());
          } else if (template === '1/0') {
            isValid = ['1', '0', 1, 0].includes(value);
          } else if (template === 'on/off') {
            isValid = ['on', 'off', 'On', 'Off', 'ON', 'OFF'].includes(String(value).toLowerCase());
          }
          
          if (!isValid) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid boolean value (${template})`,
              type: 'validation'
            });
          }
        }
        
        // Enhanced date validation
        if ((fieldType === 'date' || fieldType === 'datetime') && value !== '') {
          let isValidDate = false;
          
          try {
            const dateValue = String(value).trim();
            
            // Reject numeric-only values
            if (/^\d+$/.test(dateValue)) {
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `${field.name} must be a valid date format (not just numbers)`,
                type: 'validation'
              });
              return;
            }
            
            // Parse and validate date
            const date = new Date(value);
            isValidDate = !isNaN(date.getTime());
            
            // Additional format validation
            if (isValidDate) {
              const dateFormat = fieldAny.date_format || fieldAny.format;
              if (dateFormat) {
                // Validate against specific format if provided
                const dateStr = String(value);
                if (dateFormat === 'YYYY-MM-DD' && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                  isValidDate = false;
                } else if (dateFormat === 'MM/DD/YYYY' && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                  isValidDate = false;
                } else if (dateFormat === 'DD/MM/YYYY' && !/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
                  isValidDate = false;
                } else if (dateFormat === 'YYYY/MM/DD' && !/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
                  isValidDate = false;
                }
              }
              
              // Check date range if specified
              const minDate = fieldAny.min_date;
              const maxDate = fieldAny.max_date;
              if (minDate && date < new Date(minDate)) {
                newErrors.push({
                  rowIndex: displayRowIndex,
                  columnIndex: colIdx,
                  message: `${field.name} must be after ${minDate}`,
                  type: 'validation'
                });
              }
              if (maxDate && date > new Date(maxDate)) {
                newErrors.push({
                  rowIndex: displayRowIndex,
                  columnIndex: colIdx,
                  message: `${field.name} must be before ${maxDate}`,
                  type: 'validation'
                });
              }
            }
          } catch (e) {
            isValidDate = false;
          }
          
          if (!isValidDate) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid date format`,
              type: 'validation'
            });
          }
        }
        
        // Enhanced email validation
        if ((fieldType === 'email' || field.name.toLowerCase().includes('email')) && value !== '') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          const isValidEmail = emailRegex.test(String(value));
          
          if (!isValidEmail) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid email address`,
              type: 'validation'
            });
          }
        }
        
        // Phone number validation
        if ((fieldType === 'phone' || field.name.toLowerCase().includes('phone')) && value !== '') {
          const phoneRegex = /^[\+]?[\d\s\-\(\)]{7,15}$/;
          if (!phoneRegex.test(String(value))) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid phone number`,
              type: 'validation'
            });
          }
        }
        
        // URL validation
        if ((fieldType === 'url' || field.name.toLowerCase().includes('url') || field.name.toLowerCase().includes('website')) && value !== '') {
          try {
            new URL(String(value));
          } catch {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be a valid URL`,
              type: 'validation'
            });
          }
        }
        
        // Select/Enum validation
        if ((fieldType === 'select' || fieldType === 'enum') && value !== '') {
          const options = fieldAny.validation_format ? 
            fieldAny.validation_format.split(',').map((opt: string) => opt.trim()) : 
            fieldAny.options || [];
          
          if (options.length > 0 && !options.map((o: string) => o.toLowerCase()).includes(String(value).toLowerCase())) {
            newErrors.push({
              rowIndex: displayRowIndex,
              columnIndex: colIdx,
              message: `${field.name} must be one of: ${options.join(', ')}`,
              type: 'validation'
            });
          }
        }
        
        // Pattern/Regex validation
        if (fieldAny.pattern && value !== '') {
          try {
            const regex = new RegExp(fieldAny.pattern);
            if (!regex.test(String(value))) {
              newErrors.push({
                rowIndex: displayRowIndex,
                columnIndex: colIdx,
                message: `${field.name} does not match required pattern`,
                type: 'validation'
              });
            }
          } catch (e) {
            // Invalid regex pattern, skip validation
            console.warn(`Invalid regex pattern for field ${field.name}: ${fieldAny.pattern}`);
          }
        }
      });
    });
    
    // Combine validation errors with conflict errors
    const allErrors = [...newErrors, ...conflicts.map(conflict => ({
      rowIndex: conflict.rowIndex,
      columnIndex: conflict.columnIndex,
      message: conflict.message,
      type: 'conflict' as const
    }))];
    
    setErrors(allErrors);
    shouldValidateRef.current = false;
  }, [dataRows, columnMapping, template, headerRowIndex, conflicts]);
  
  // Run validation when needed
  React.useEffect(() => {
    validateData();
  }, [validateData]);
  
  // Handle cell edit with debouncing to prevent too many updates
  const handleCellEdit = React.useCallback((rowIdx: number, colIdx: number, value: string) => {
    setEditedValues(prev => {
      // Only update if value actually changed
      const currentValue = prev[rowIdx]?.[colIdx];
      if (currentValue === value) return prev;
      
      const newEditedValues = {
        ...prev,
        [rowIdx]: {
          ...(prev[rowIdx] || {}),
          [colIdx]: value
        }
      };
      
      // Mark that we need to re-validate after this edit
      shouldValidateRef.current = true;
      
      return newEditedValues;
    });
  }, []);
  
  // Filter rows if showing only errors
  const visibleRows = useMemo(() => {
    if (!showOnlyErrors) return dataRows;
    
    return dataRows.filter((_, rowIdx) => {
      const displayRowIndex = rowIdx + headerRowIndex + 1;
      return errors.some(err => err.rowIndex === displayRowIndex);
    });
  }, [dataRows, showOnlyErrors, errors, headerRowIndex]);
  
  // Enhanced error tracking with conflict detection
  const errorTracking = useMemo(() => {
    const validationIndices = new Set<number>();
    const conflictIndices = new Set<number>();
    const allIndices = new Set<number>();
    const rowObjects = new Set<number>();
    
    errors.forEach(err => {
      // Convert from display row index to actual data row index
      const dataRowIdx = err.rowIndex - headerRowIndex - 1;
      if (dataRowIdx >= 0 && dataRowIdx < dataRows.length) {
        allIndices.add(dataRowIdx);
        
        if (err.type === 'conflict') {
          conflictIndices.add(dataRowIdx);
        } else {
          validationIndices.add(dataRowIdx);
        }
        
        rowObjects.add(dataRows[dataRowIdx]?.index || -1);
      }
    });
    
    return {
      allIndices,
      validationIndices,
      conflictIndices,
      objects: Array.from(rowObjects).filter(idx => idx !== -1),
      validationCount: validationIndices.size,
      conflictCount: conflictIndices.size,
      totalCount: allIndices.size
    };
  }, [errors, headerRowIndex, dataRows]);

  // Handle form submission
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    
    if (disableOnInvalidRows && errors.length > 0) {
      return; // Don't submit if disableOnInvalidRows is true and there are errors
    }
    
    // Update the data with edited values
    const updatedData = dataRows.map((row, rowIdx) => {
      // Apply edited values to this row
      const values = [...row.values];
      
      if (editedValues[rowIdx]) {
        Object.entries(editedValues[rowIdx]).forEach(([colIdx, value]) => {
          values[parseInt(colIdx)] = value;
        });
      }
      
      return { ...row, values };
    });
    
    // Filter out rows with errors if filterInvalidRows is enabled
    const filteredData = filterInvalidRows 
      ? updatedData.filter((_, rowIdx) => !errorTracking.allIndices.has(rowIdx))
      : updatedData;
    
    // Call onSuccess with the updated data
    onSuccess({
      ...fileData,
      rows: [headerRow, ...filteredData]
    });
  };

  // Render the component
  return (
    <div className={style.validationContainer}>
      <div className={style.header}>
        <h2>{t('validation.title', 'Validate Data')}</h2>
        <p>{t('validation.description', 'Review and correct any errors in your data before importing.')}</p>
      </div>
      
      <div className={style.validationContent}>
        {errors.length > 0 && (
          <div className={style.errorSummary}>
            <Flex justify="space-between" align="center">
              <Box>
                <Text color="red.500" fontWeight="bold">
                  {errors.length} {errors.length === 1 ? 'issue' : 'issues'} found
                </Text>
                {errorTracking.validationCount > 0 && (
                  <Text color="orange.500" fontSize="sm">
                    {errorTracking.validationCount} validation {errorTracking.validationCount === 1 ? 'error' : 'errors'}
                  </Text>
                )}
                {errorTracking.conflictCount > 0 && (
                  <Text color="red.600" fontSize="sm">
                    {errorTracking.conflictCount} database {errorTracking.conflictCount === 1 ? 'conflict' : 'conflicts'}
                  </Text>
                )}
              </Box>
              {isCheckingConflicts && (
                <Text fontSize="sm" color="blue.500">Checking for conflicts...</Text>
              )}
            </Flex>
          </div>
        )}
        
        {filterInvalidRows && errorTracking.totalCount > 0 && (
          <Alert status="warning" variant="left-accent" mt={4} mb={4}>
            <AlertIcon />
            <Box>
              <AlertTitle>{t('validation.invalidRowsWarning', 'Invalid Rows Will Be Filtered')}</AlertTitle>
              <AlertDescription>
                {t('validation.invalidRowsDescription', 
                  `${errorTracking.totalCount} ${errorTracking.totalCount === 1 ? 'row' : 'rows'} with validation errors or conflicts will be excluded from the import. You can fix the errors to include these rows.`
                )}
              </AlertDescription>
            </Box>
          </Alert>
        )}
        
        <div className={style.validationFilters}>
          <Flex align="center" gap={4}>
            <Flex align="center">
              <Switch 
                id="show-errors-only" 
                isChecked={showOnlyErrors} 
                onChange={(e) => setShowOnlyErrors(e.target.checked)} 
                mr={2}
              />
              <Text fontSize="sm">Show only rows with errors</Text>
            </Flex>
            {isCheckingConflicts && (
              <Text fontSize="sm" color="blue.500">🔄 Checking conflicts...</Text>
            )}
          </Flex>
        </div>
        
        <div className={style.tableContainer}>
          <table className={style.validationTable}>
            <thead>
              <tr>
                {headers.map((header, idx) => (
                  <th key={idx}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, rowIdx) => {
                const actualRowIdx = dataRows.indexOf(row);
                const displayRowIndex = actualRowIdx + headerRowIndex + 1;
                const rowValidationErrors = errors.filter(err => err.rowIndex === displayRowIndex && err.type !== 'conflict');
                const rowConflicts = errors.filter(err => err.rowIndex === displayRowIndex && err.type === 'conflict');
                const hasValidationError = rowValidationErrors.length > 0;
                const hasConflict = rowConflicts.length > 0;
                
                // Determine row styling based on error types
                let rowClass = '';
                if (hasConflict) {
                  rowClass = `${style.conflictRow} ${style.errorRow}`; // Red background for conflicts
                } else if (hasValidationError) {
                  rowClass = style.errorRow; // Orange/yellow background for validation errors
                }
                
                return (
                  <tr key={rowIdx} className={rowClass}>
                    {includedColumns.map((colIdx, idx) => {
                      const originalValue = row.values[colIdx];
                      const editedValue = editedValues[actualRowIdx]?.[colIdx];
                      const value = editedValue !== undefined ? editedValue : originalValue;
                      
                      const cellErrors = errors.filter(
                        err => err.rowIndex === displayRowIndex && err.columnIndex === colIdx
                      );
                      const cellConflicts = cellErrors.filter(err => err.type === 'conflict');
                      const cellValidationErrors = cellErrors.filter(err => err.type !== 'conflict');
                      
                      const hasCellError = cellErrors.length > 0;
                      const hasCellConflict = cellConflicts.length > 0;
                      
                      return (
                        <td key={idx}>
                          <div className={style.editableCellContainer}>
                            <Input
                              size="sm"
                              value={String(value || '')}
                              onChange={(e) => handleCellEdit(actualRowIdx, colIdx, e.target.value)}
                              className={`${style.simpleInput} ${hasCellError ? style.errorInput : ''} ${hasCellConflict ? style.conflictInput : ''}`}
                            />
                            {hasCellError && (
                              <div className={style.errorIndicators}>
                                {/* Red error marker for conflicts */}
                                {hasCellConflict && (
                                  <Tooltip 
                                    label={cellConflicts.map(err => err.message).join('; ')} 
                                    placement="top"
                                    bg="red.600"
                                    color="white"
                                  >
                                    <Box className={`${style.errorIcon} ${style.conflictIcon}`}>
                                      ⚠
                                    </Box>
                                  </Tooltip>
                                )}
                                {/* Orange error marker for validation errors */}
                                {cellValidationErrors.length > 0 && (
                                  <Tooltip 
                                    label={cellValidationErrors.map(err => err.message).join('; ')} 
                                    placement="top"
                                    bg="orange.500"
                                    color="white"
                                  >
                                    <Box className={`${style.errorIcon} ${style.validationIcon}`}>
                                      !
                                    </Box>
                                  </Tooltip>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        
        <form onSubmit={handleSubmit}>
          <Flex justify="space-between" mt={4}>
            <Button onClick={onCancel} isDisabled={isSubmitting}>
              {t('common.back', 'Back')}
            </Button>
            <Button
              type="submit"
              colorScheme="blue"
              isLoading={isSubmitting}
              isDisabled={disableOnInvalidRows && errors.length > 0}
            >
              {t('common.continue', 'Continue')}
            </Button>
          </Flex>
        </form>
      </div>
      

    </div>
  );
}
