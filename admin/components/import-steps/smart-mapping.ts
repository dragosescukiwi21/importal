// Smart mapping utility for matching CSV columns to importer fields
export interface SmartMappingSuggestion {
  csvColumn: string;
  importerField: string;
  confidence: number;
  reason: string;
}

export function generateSmartMappings(
  csvHeaders: string[],
  csvData: any[],
  importerFields: any[]
): SmartMappingSuggestion[] {
  const suggestions: SmartMappingSuggestion[] = [];

  // Get first 3 sample values for each CSV column for analysis
  const getSampleData = (header: string): string[] => {
    if (!csvData || csvData.length === 0) return [];
    return csvData
      .slice(0, 3)
      .map(row => String(row[header] || '').trim())
      .filter(val => val !== '');
  };

  // Scoring functions for different matching strategies
  const scoreExactMatch = (csvHeader: string, fieldName: string): number => {
    const csvLower = csvHeader.toLowerCase().trim();
    const fieldLower = fieldName.toLowerCase().trim();
    
    if (csvLower === fieldLower) return 100;
    
    // Check field label if available
    return 0;
  };

  const scorePartialMatch = (csvHeader: string, fieldName: string, fieldLabel?: string): number => {
    const csvLower = csvHeader.toLowerCase().trim();
    const fieldLower = fieldName.toLowerCase().trim();
    const labelLower = fieldLabel?.toLowerCase().trim() || '';
    
    let score = 0;
    
    // Check if CSV header contains field name or vice versa
    if (csvLower.includes(fieldLower) || fieldLower.includes(csvLower)) {
      score = Math.max(score, 80);
    }
    
    // Check if CSV header contains field label or vice versa
    if (labelLower && (csvLower.includes(labelLower) || labelLower.includes(csvLower))) {
      score = Math.max(score, 85);
    }
    
    return score;
  };

  const scoreSemanticMatch = (csvHeader: string, fieldName: string, fieldType: string): number => {
    const csvLower = csvHeader.toLowerCase().trim();
    const fieldLower = fieldName.toLowerCase().trim();
    
    // Common semantic mappings
    const semanticMappings: Record<string, string[]> = {
      // Names
      'name': ['name', 'full_name', 'fullname', 'customer_name', 'user_name', 'username', 'person', 'contact'],
      'first_name': ['first', 'fname', 'first_name', 'firstname', 'given_name'],
      'last_name': ['last', 'lname', 'last_name', 'lastname', 'surname', 'family_name'],
      
      // Contact Info
      'email': ['email', 'email_address', 'e_mail', 'mail', 'contact_email'],
      'phone': ['phone', 'telephone', 'mobile', 'cell', 'contact_number', 'phone_number'],
      
      // Financial
      'price': ['price', 'cost', 'amount', 'value', 'rate', 'fee'],
      'quantity': ['quantity', 'qty', 'amount', 'count', 'number', 'units'],
      
      // Identifiers
      'id': ['id', 'identifier', 'key', 'reference', 'ref'],
      'symbol': ['symbol', 'ticker', 'code', 'abbreviation', 'abbr'],
      
      // Types and Categories
      'type': ['type', 'category', 'class', 'kind', 'classification'],
      'status': ['status', 'state', 'condition', 'situation'],
      
      // Dates
      'date': ['date', 'created', 'updated', 'timestamp', 'time'],
      'purchase_date': ['purchase', 'bought', 'acquired', 'purchase_date'],
      
      // Addresses
      'address': ['address', 'location', 'street', 'addr'],
      'city': ['city', 'town', 'municipality'],
      'state': ['state', 'province', 'region'],
      'zip': ['zip', 'postal', 'postcode', 'zipcode'],
      'country': ['country', 'nation']
    };

    let bestScore = 0;
    let bestReason = '';

    // Check if field name has semantic mappings
    if (semanticMappings[fieldLower]) {
      for (const synonym of semanticMappings[fieldLower]) {
        if (csvLower === synonym) {
          bestScore = Math.max(bestScore, 90);
          bestReason = `"${csvHeader}" matches semantic meaning of "${fieldName}"`;
        } else if (csvLower.includes(synonym) || synonym.includes(csvLower)) {
          bestScore = Math.max(bestScore, 70);
          bestReason = `"${csvHeader}" partially matches semantic meaning of "${fieldName}"`;
        }
      }
    }

    // Check reverse - if CSV header has semantic mappings
    for (const [semanticField, synonyms] of Object.entries(semanticMappings)) {
      if (synonyms.includes(csvLower) && fieldLower.includes(semanticField)) {
        bestScore = Math.max(bestScore, 75);
        bestReason = `"${csvHeader}" semantically relates to "${fieldName}"`;
      }
    }

    return bestScore;
  };

  const scoreDataTypeMatch = (csvHeader: string, sampleData: string[], fieldType: string): number => {
    if (sampleData.length === 0) return 0;
    
    let score = 0;
    let matchCount = 0;
    
    for (const sample of sampleData) {
      switch (fieldType.toLowerCase()) {
        case 'email':
          if (sample.includes('@') && sample.includes('.')) {
            matchCount++;
          }
          break;
        case 'phone':
          if (/[\d\-\+\(\)\s]{7,}/.test(sample)) {
            matchCount++;
          }
          break;
        case 'number':
        case 'integer':
        case 'float':
          if (!isNaN(parseFloat(sample))) {
            matchCount++;
          }
          break;
        case 'date':
          if (Date.parse(sample) || /\d{1,4}[-\/]\d{1,2}[-\/]\d{1,4}/.test(sample)) {
            matchCount++;
          }
          break;
        case 'url':
          if (sample.startsWith('http') || sample.startsWith('www')) {
            matchCount++;
          }
          break;
        case 'boolean':
          if (['true', 'false', 'yes', 'no', '1', '0', 'y', 'n'].includes(sample.toLowerCase())) {
            matchCount++;
          }
          break;
      }
    }
    
    if (matchCount > 0) {
      score = (matchCount / sampleData.length) * 60; // Max 60 points for data type match
    }
    
    return score;
  };

  // Generate suggestions for each CSV column
  for (const csvHeader of csvHeaders) {
    const sampleData = getSampleData(csvHeader);
    let bestMatch: SmartMappingSuggestion | null = null;

    for (const field of importerFields) {
      const fieldName = field.name || '';
      const fieldLabel = field.label || field.display_name || '';
      const fieldType = field.type || 'text';

      // Calculate scores using different strategies
      const exactScore = scoreExactMatch(csvHeader, fieldName);
      const partialScore = scorePartialMatch(csvHeader, fieldName, fieldLabel);
      const semanticScore = scoreSemanticMatch(csvHeader, fieldName, fieldType);
      const dataTypeScore = scoreDataTypeMatch(csvHeader, sampleData, fieldType);

      // Combine scores with weights
      const totalScore = Math.max(
        exactScore,
        partialScore,
        semanticScore
      ) + (dataTypeScore * 0.3); // Data type is supporting evidence

      // Determine reason for the match
      let reason = '';
      if (exactScore === 100) {
        reason = `Exact name match`;
      } else if (partialScore >= 80) {
        reason = `Strong name similarity`;
      } else if (semanticScore >= 70) {
        reason = `Semantic meaning match`;
      } else if (partialScore >= 50) {
        reason = `Partial name match`;
      } else if (dataTypeScore >= 30) {
        reason = `Data type compatibility`;
      } else {
        reason = `Low confidence suggestion`;
      }

      // Add data type confirmation if applicable
      if (dataTypeScore >= 30) {
        reason += ` (${Math.round(dataTypeScore * 100 / 60)}% data type match)`;
      }

      if (totalScore > 30 && (!bestMatch || totalScore > bestMatch.confidence)) {
        bestMatch = {
          csvColumn: csvHeader,
          importerField: fieldName,
          confidence: Math.min(100, Math.round(totalScore)),
          reason: reason
        };
      }
    }

    if (bestMatch) {
      suggestions.push(bestMatch);
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return 'text-green-600';
  if (confidence >= 60) return 'text-yellow-600';
  if (confidence >= 40) return 'text-orange-600';
  return 'text-red-600';
}

export function getConfidenceBadgeVariant(confidence: number): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (confidence >= 80) return 'default';
  if (confidence >= 60) return 'secondary';
  if (confidence >= 40) return 'outline';
  return 'destructive';
}
