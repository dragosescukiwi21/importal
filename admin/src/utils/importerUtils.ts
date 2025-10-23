// First, define a clean interface for your field object.
// This will be shared with your page components.
export interface ImporterField {
  name: string;
  display_name?: string;
  type: string;
  required: boolean;
  description?: string;
  must_match: boolean;
  not_blank: boolean;
  example?: string;
  validation_error_message?: string;
  extra_rules?: Record<string, any>;
  // UI-only property for the form state
  formatOption?: string;
}

// Single source of truth for format options mapping
export const FORMAT_OPTIONS_CONFIG = {
  number: {
    'Any': "",
    'Positive': "positive",
    'Negative': "negative"
  },
  date: {
    'Any': "",
    'MM/DD/YYYY': "MM/DD/YYYY",
    'DD/MM/YYYY': "DD/MM/YYYY",
    'YYYY/MM/DD': "YYYY/MM/DD"
  },
  boolean: {
    'Any': "",
    'True/False': "true_false",
    'Yes/No': "yes_no",
    '1/0': "1_0",
    'on/off': "on_off"
  }
} as const;

/**
 * Prepares a field from the UI form to be sent to the backend API.
 * Converts the UI-friendly `formatOption` into a structured `extra_rules` object.
 */
export const prepareFieldForApi = (field: ImporterField) => {
  console.log('[prepareFieldForApi] Input field:', field);
  console.log('[prepareFieldForApi] formatOption:', field.formatOption);
  
  const fieldToSave: Partial<ImporterField> = { ...field };
  let rules = {};

  const type = field.type as keyof typeof FORMAT_OPTIONS_CONFIG;
  console.log('[prepareFieldForApi] Field type:', type);

  if (type in FORMAT_OPTIONS_CONFIG) {
    const config = FORMAT_OPTIONS_CONFIG[type];
    console.log('[prepareFieldForApi] Config for type:', config);
    
    const option = field.formatOption as keyof typeof config;
    console.log('[prepareFieldForApi] Looking up option:', option);
    
    const ruleValue = config[option] || "";
    console.log('[prepareFieldForApi] Rule value found:', ruleValue);

    if (ruleValue) {
        if (type === 'number') {
          rules = { sign: ruleValue };
          console.log('[prepareFieldForApi] Set number rules:', rules);
        }
        if (type === 'date') {
          rules = { format: ruleValue };
          console.log('[prepareFieldForApi] Set date rules:', rules);
        }
        if (type === 'boolean') {
          rules = { template: ruleValue };
          console.log('[prepareFieldForApi] Set boolean rules:', rules);
        }
    } else {
      console.log('[prepareFieldForApi] No rule value, keeping empty rules');
    }
  } else {
    console.log('[prepareFieldForApi] Type not in FORMAT_OPTIONS_CONFIG');
  }

  fieldToSave.extra_rules = rules;
  console.log('[prepareFieldForApi] Final extra_rules:', fieldToSave.extra_rules);
  
  delete fieldToSave.formatOption;
  return fieldToSave;
};

/**
 * Prepares a field from the backend API to be used in the UI form.
 * Converts the backend `extra_rules` object back into a UI-friendly `formatOption` string.
 */
export const mapExtraRulesToFormatOption = (field: ImporterField): string => {
  const { type, extra_rules } = field;

  // Handle cases where extra_rules might be null or undefined
  if (!extra_rules) {
    return "Any";
  }

  const findKeyByValue = (obj: Record<string, string>, value: string) => 
    Object.keys(obj).find(key => obj[key] === value);

  let ruleValue: string | undefined;
  // ✅ FIX: Correctly get the rule value from the nested object's properties
  if (type === 'number') ruleValue = (extra_rules as any).sign;
  if (type === 'date') ruleValue = (extra_rules as any).format;
  if (type === 'boolean') ruleValue = (extra_rules as any).template;
  
  const config = FORMAT_OPTIONS_CONFIG[type as keyof typeof FORMAT_OPTIONS_CONFIG];
  if (config && ruleValue) {
    const foundOption = findKeyByValue(config, ruleValue);
    if (foundOption) return foundOption;
  }
  
  return "Any"; // Default if no rule is found
};