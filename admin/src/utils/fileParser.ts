import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface FileParserResult {
  headers: string[];
  allHeaders: string[];
  selectedHeaders: string[];
  data: Record<string, string>[];
  errors: string[];
  fileType: string;
  sheetNames?: string[];
  selectedSheet?: string;
}

export interface FileParserOptions {
  delimiter?: string;
  encoding?: string;
  sheetName?: string;
}

/**
 * Detects file type based on file extension and content
 * @param file - The file to detect type for
 * @returns Promise resolving to the detected file type
 */
export async function detectFileType(file: File): Promise<string> {
  const extension = file.name.toLowerCase().split('.').pop() || '';
  
  // Check by extension first
  if (extension === 'csv') return 'csv';
  if (extension === 'xlsx') return 'xlsx';
  if (extension === 'xls') return 'xls';
  if (extension === 'ods') return 'ods';
  
  // For files without extension or unknown extensions, try to detect by content
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (buffer) {
        const uint8Array = new Uint8Array(buffer);
        
        // Check for Excel file signatures
        // XLSX: PK\x03\x04 (ZIP file)
        // XLS: \xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1 (OLE compound file)
        // ODS: PK\x03\x04 (ZIP file, but we'll need to check for specific ODS content)
        
        if (uint8Array.length >= 4 && 
            uint8Array[0] === 0x50 && uint8Array[1] === 0x4B && 
            uint8Array[2] === 0x03 && uint8Array[3] === 0x04) {
          // This is a ZIP file, could be XLSX or ODS
          // For now, we'll assume XLSX, but we could add more sophisticated detection
          resolve('xlsx');
        } else if (uint8Array.length >= 8 && 
                   uint8Array[0] === 0xD0 && uint8Array[1] === 0xCF && 
                   uint8Array[2] === 0x11 && uint8Array[3] === 0xE0) {
          resolve('xls');
        } else {
          // Assume CSV for text-based files
          resolve('csv');
        }
      } else {
        resolve('csv'); // Default to CSV
      }
    };
    // Read first 8 bytes for file signature detection
    const slice = file.slice(0, 8);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Parses Excel files (XLS, XLSX, ODS) using SheetJS
 * @param file - The Excel file to parse
 * @param options - Parsing options including sheet name
 * @returns Promise resolving to parsed Excel data
 */
async function parseExcelFile(
  file: File,
  options: FileParserOptions = {}
): Promise<FileParserResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error("Failed to read file"));
          return;
        }

        // Read the workbook
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetNames = workbook.SheetNames;
        
        if (sheetNames.length === 0) {
          reject(new Error("No sheets found in Excel file"));
          return;
        }

        // Select sheet (use provided sheet name or first sheet)
        const sheetName = options.sheetName || sheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        if (!worksheet) {
          reject(new Error(`Sheet "${sheetName}" not found. Available sheets: ${sheetNames.join(', ')}`));
          return;
        }

        // Convert to JSON with headers
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { 
          header: 1,
          defval: '', // Default value for empty cells
          raw: false  // Convert all values to strings
        }) as string[][];

        if (jsonData.length === 0) {
          reject(new Error("Excel file appears to be empty"));
          return;
        }

        // Extract headers (first row)
        const headers = jsonData[0].map(header => String(header || ''));
        
        // Remove empty headers
        const validHeaders = headers.filter(header => header.trim() !== '');
        
        if (validHeaders.length === 0) {
          reject(new Error("No valid headers found in Excel file"));
          return;
        }

        // Convert data rows to objects
        const dataRows = jsonData.slice(1).filter(row => 
          row.some(cell => cell !== undefined && cell !== null && String(cell).trim() !== '')
        );

        const parsedData: Record<string, string>[] = dataRows.map(row => {
          const obj: Record<string, string> = {};
          validHeaders.forEach((header, index) => {
            obj[header] = String(row[index] || '');
          });
          return obj;
        });

        const errors: string[] = [];
        
        // Check for empty data
        if (parsedData.length === 0) {
          errors.push("Excel file contains no data rows");
        }

        // Check for ragged rows (rows with different column counts)
        const expectedColumnCount = validHeaders.length;
        dataRows.forEach((row, index) => {
          const actualColumnCount = Math.min(row.length, expectedColumnCount);
          if (actualColumnCount < expectedColumnCount) {
            errors.push(`Row ${index + 2} has fewer columns than expected (${actualColumnCount} vs ${expectedColumnCount})`);
          }
        });

        const result: FileParserResult = {
          headers: validHeaders,
          allHeaders: validHeaders,
          selectedHeaders: validHeaders,
          data: parsedData,
          errors,
          fileType: file.name.toLowerCase().includes('.xls') ? 'xls' : 'xlsx',
          sheetNames,
          selectedSheet: sheetName
        };

        resolve(result);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };

    reader.readAsBinaryString(file);
  });
}

/**
 * RFC 4180 compliant CSV parser optimized for large files
 * @param file - The CSV file to parse
 * @param options - Parsing options
 * @returns Promise resolving to parsed CSV data and any errors
 */
async function parseCSVFile(
  file: File,
  options: FileParserOptions = {}
): Promise<FileParserResult> {
  return new Promise((resolve, reject) => {
    // For large files (>5MB), use Papa Parse's streaming mode directly on the file
    // This avoids loading the entire file into memory at once
    if (file.size > 5 * 1024 * 1024) {
      console.log(`Parsing large CSV file (${(file.size / 1024 / 1024).toFixed(2)}MB) using streaming mode`);
      
      let headers: string[] = [];
      const rows: Record<string, string>[] = [];
      const errors: string[] = [];
      let rowCount = 0;
      
      Papa.parse(file, {
        // RFC 4180 compliant settings
        header: true,
        dynamicTyping: false, // Keep all data as strings
        skipEmptyLines: "greedy",
        delimiter: options.delimiter || "", // Auto-detect if not specified
        newline: "", // Auto-detect line endings
        quoteChar: '"',
        escapeChar: '"', // RFC 4180: quotes are escaped by doubling
        comments: false, // RFC 4180 doesn't support comments
        
        // Streaming settings for large files
        worker: false, // Avoid web worker complexity
        chunkSize: 64 * 1024, // Process in 64KB chunks
        
        // Callbacks
        chunk: (results, parser) => {
          // Store headers from first chunk
          if (!headers.length && results.meta.fields) {
            headers = results.meta.fields;
          }
          
          // Add rows (limit to prevent memory issues)
          if (rowCount < 50000) { // Limit to 50k rows for UI
            rows.push(...(results.data as Record<string, string>[]));
            rowCount += results.data.length;
          }
          
          // Collect errors
          if (results.errors.length > 0) {
            errors.push(...results.errors.slice(0, 10).map(e => e.message));
          }
        },
        complete: () => {
          const result: FileParserResult = {
            headers,
            allHeaders: headers,
            selectedHeaders: headers,
            data: rows,
            errors,
            fileType: 'csv'
          };
          resolve(result);
        },
        error: (error) => {
          reject(new Error(`CSV parsing failed: ${error.message}`));
        }
      });
    } else {
      // For smaller files, read as text for better control
      console.log(`Parsing CSV file (${(file.size / 1024).toFixed(2)}KB) using standard mode`);
      
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          if (!text) {
            reject(new Error("Failed to read file"));
            return;
          }
        
        // First, check if this is a single column CSV by looking for common delimiters
        const firstLines = text.split('\n').slice(0, 5).join('\n');
        const hasComma = firstLines.includes(',');
        const hasSemicolon = firstLines.includes(';');
        const hasTab = firstLines.includes('\t');
        const hasPipe = firstLines.includes('|');
        
        // If no delimiter is specified and none of the common delimiters are found,
        // it's likely a single column CSV, so use newline as delimiter for parsing
        let delimiter = options.delimiter;
        if (!delimiter && !hasComma && !hasSemicolon && !hasTab && !hasPipe) {
          // Single column CSV - use comma as default (Papa Parse will handle it correctly)
          delimiter = ',';
        }
        
        // Parse with Papa Parse using RFC 4180 compliant settings
        // Add worker:false to avoid web worker issues and dynamicTyping:false for stability
        const parsed = Papa.parse(text, {
          header: true, // Parse with headers
          skipEmptyLines: "greedy", // Skip empty lines
          delimiter: delimiter, // Use detected or specified delimiter
          dynamicTyping: false, // Keep everything as strings
          worker: false, // Don't use web workers to avoid complexity
          chunkSize: 1024 * 1024, // Process in 1MB chunks
          transform: (value) => {
            // Simple trim without complex processing
            return typeof value === 'string' ? value.trim() : String(value || '').trim();
          },
          quoteChar: '"', // Use double quotes
          escapeChar: '"', // Escape quotes with quotes
        });
        
        // Validate parsing results
        const errors: string[] = [];
        
        // Check for parsing errors from Papa Parse
        if (parsed.errors.length > 0) {
          // Filter out minor warnings and focus on critical errors
          const criticalErrors = parsed.errors.filter(
            (error) => error.type !== "FieldMismatch" // We'll handle this separately
          );
          
          if (criticalErrors.length > 0) {
            errors.push(
              ...criticalErrors.map(
                (error) => `Line ${error.row}: ${error.message}`
              )
            );
          }
        }
        
        // Validate header consistency (ragged rows) - limit checking to first 100 rows for performance
        if (parsed.data.length > 0 && parsed.meta.fields) {
          const expectedColumnCount = parsed.meta.fields.length;
          const rowsToCheck = Math.min(100, parsed.data.length);
          
          // Check only first 100 rows for consistent column count to avoid performance issues
          for (let index = 0; index < rowsToCheck; index++) {
            const row = parsed.data[index] as any;
            const actualColumnCount = Object.keys(row).length;
            if (actualColumnCount !== expectedColumnCount) {
              errors.push(
                `Row ${index + 1} has ${actualColumnCount} columns, but expected ${expectedColumnCount}.`
              );
            }
          }
        }
        
        // Check for empty data
        if (parsed.data.length === 0) {
          errors.push("CSV file appears to be empty");
        }
        
        // Check for missing headers
        if (!parsed.meta.fields || parsed.meta.fields.length === 0) {
          errors.push("No headers found in CSV file");
        }
        
        // If we have critical errors, reject the promise
        if (errors.some(error => error.includes("Line") || error.includes("malformed"))) {
          reject(new Error(`CSV Parsing Error: ${errors.join("; ")}`));
          return;
        }
        
        // Prepare the result
        const headers = parsed.meta.fields || [];
        const result: FileParserResult = {
          headers,
          allHeaders: headers,
          selectedHeaders: headers,
          data: parsed.data as Record<string, string>[],
          errors,
          fileType: 'csv'
        };
        
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };
    
    // Always read as UTF-8 for simplicity and browser compatibility
    reader.readAsText(file, "utf-8");
    }
  });
}

/**
 * Main file parser function that handles all supported file types
 * @param file - The file to parse
 * @param options - Parsing options
 * @returns Promise resolving to parsed file data
 */
export async function parseFile(
  file: File,
  options: FileParserOptions = {}
): Promise<FileParserResult> {
  const fileType = await detectFileType(file);
  
  switch (fileType) {
    case 'csv':
      return await parseCSVFile(file, options);
    case 'xlsx':
    case 'xls':
    case 'ods':
      return await parseExcelFile(file, options);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/**
 * Validates file syntax based on file type
 * @param file - The file to validate
 * @returns Promise resolving to array of syntax errors
 */
export async function validateFileSyntax(file: File): Promise<string[]> {
  const fileType = await detectFileType(file);
  
  if (fileType === 'csv') {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const errors: string[] = [];
        
        // Use Papa Parse to check for syntax issues
        const parsed = Papa.parse(text, {
          header: false,
          skipEmptyLines: true,
        });
        
        // Check for critical parsing errors
        parsed.errors.forEach((error) => {
          if (error.type === "Quotes") {
            errors.push(`Malformed CSV at line ${error.row}: ${error.message}`);
          }
        });
        
        resolve(errors);
      };
      reader.readAsText(file);
    });
  } else {
    // For Excel files, we'll validate during parsing
    try {
      const result = await parseFile(file);
      return result.errors;
    } catch (error) {
      return [error instanceof Error ? error.message : 'Unknown error'];
    }
  }
}

// Export the original CSV parser for backward compatibility
// Note: We're re-exporting our own parseCSVFile function above
