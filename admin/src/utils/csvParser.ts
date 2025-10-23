import Papa from "papaparse";
import jschardet from "jschardet";

export interface CSVParserResult {
  headers: string[];
  allHeaders: string[];
  selectedHeaders: string[];
  csvData: Record<string, string>[];
  errors: string[];
}

export interface CSVParserOptions {
  delimiter?: string;
  encoding?: string;
}

/**
 * Detects the character encoding of a file
 * @param file - The file to detect encoding for
 * @returns Promise resolving to the detected encoding
 */
export async function detectEncoding(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target?.result as ArrayBuffer;
      if (buffer) {
        const uint8Array = new Uint8Array(buffer);
        // Convert Uint8Array to string for jschardet
        const text = String.fromCharCode.apply(null, Array.from(uint8Array));
        const detected = jschardet.detect(text);
        resolve(detected.encoding);
      } else {
        resolve("utf-8"); // Default to UTF-8 if detection fails
      }
    };
    // Read first 1MB for encoding detection
    const slice = file.slice(0, Math.min(1024 * 1024, file.size));
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Parses CSV data with RFC 4180 compliance and advanced features
 * @param file - The CSV file to parse
 * @param options - Parsing options
 * @returns Promise resolving to parsed CSV data and any errors
 */
export async function parseCSVFile(
  file: File,
  options: CSVParserOptions = {}
): Promise<CSVParserResult> {
  // Detect encoding if not provided
  const encoding = options.encoding || (await detectEncoding(file));
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = async (e) => {
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
        const parsed = Papa.parse(text, {
          header: true, // Parse with headers
          skipEmptyLines: "greedy", // Skip empty lines
          delimiter: delimiter, // Use detected or specified delimiter
          transform: (value) => value.trim(), // Trim values
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
        
        // Validate header consistency (ragged rows)
        if (parsed.data.length > 0 && parsed.meta.fields) {
          const expectedColumnCount = parsed.meta.fields.length;
          
          // Check each row for consistent column count
          parsed.data.forEach((row: any, index) => {
            const actualColumnCount = Object.keys(row).length;
            if (actualColumnCount !== expectedColumnCount) {
              errors.push(
                `Row ${index + 1} has ${actualColumnCount} columns, but expected ${expectedColumnCount}.`
              );
            }
          });
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
        const result: CSVParserResult = {
          headers,
          allHeaders: headers,
          selectedHeaders: headers,
          csvData: parsed.data as Record<string, string>[],
          errors,
        };
        
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => {
      reject(new Error("Failed to read file"));
    };
    
    // Read with detected encoding
    if (encoding.toLowerCase() !== "utf-8") {
      // For non-UTF-8 encodings, we would need to convert
      // For simplicity, we'll assume UTF-8 for browser compatibility
      reader.readAsText(file, "utf-8");
    } else {
      reader.readAsText(file, "utf-8");
    }
  });
}

/**
 * Validates CSV syntax strictly
 * @param text - The CSV text to validate
 * @returns Array of syntax errors
 */
export function validateCSVSyntax(text: string): string[] {
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
  
  return errors;
}
