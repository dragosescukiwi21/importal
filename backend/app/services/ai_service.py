"""
AI Service - Simplified Translation Approach

The AI's ONLY job is to translate user requests into specific cell changes.
No code generation, no execution - just pure translation.
System infers operation type based on whether transformations are returned.
"""

import os
import json
import logging
from typing import Dict, List, Any, Optional
from app.models.import_job import ImportJob
import httpx

logger = logging.getLogger(__name__)


class AIService:
    def __init__(self):
        self.groq_api_key = os.getenv("OPENAI_API_KEY")
        self.groq_api_url = "https://api.groq.com/openai/v1/chat/completions"
        if not self.groq_api_key:
            logger.warning("Groq API key not found. AI features will be disabled.")

    async def generate_plan(self, import_job: ImportJob, prompt: str) -> Dict[str, Any]:
        """
        NEW SIMPLIFIED APPROACH: AI only translates user request into cell changes.
        System infers operation type based on whether transformations are returned.
        
        Returns:
        - If transformations exist: UPDATE operation
        - If transformations empty: READ/chat operation
        """
        try:
            if not import_job.processed_data:
                return {"success": False, "error": "Import job has no data available."}

            # Get data from processed_data
            full_data = import_job.processed_data.get('data', [])
            if not full_data:
                return {"success": False, "error": "No data available to process."}

            headers = list(full_data[0].keys()) if full_data else []
            
            # Create intelligent sample for AI context
            intelligent_sample = self._create_intelligent_sample(full_data)

            # Call the new simplified AI translator
            ai_result = await self._call_ai_for_plan(prompt, headers, intelligent_sample, import_job.importer)
            
            if not ai_result:
                return {
                    "success": False,
                    "error": "AI service is unavailable. Please try again later."
                }

            # System infers operation type based on transformations
            has_transformations = len(ai_result.get('transformations', [])) > 0
            
            if has_transformations:
                # UPDATE operation: AI provided specific changes
                return {
                    "success": True,
                    "operation": {
                        "type": "UPDATE",
                        "description": ai_result['description'],
                        "affected_rows": len({t['row_index'] for t in ai_result['transformations']})
                    },
                    "transformations": ai_result['transformations']
                }
            else:
                # READ/chat operation: No changes requested
                return {
                    "success": True,
                    "operation": {
                        "type": "READ",
                        "description": ai_result['description'],
                        "affected_rows": 0
                    },
                    "transformations": [],
                    "chat_message": ai_result['description']
                }
                
        except Exception as e:
            logger.error(f"Error in AI generate_plan for import {import_job.id}: {str(e)}")
            return {"success": False, "error": str(e)}

    def _create_intelligent_sample(self, data: List[Dict], count: int = 15) -> List[Dict]:
        """Creates a representative sample of the data for AI context."""
        if len(data) <= count:
            return data
        
        # Prioritize rows with the most data filled in for better context
        data_with_completeness = sorted(
            data, 
            key=lambda row: sum(1 for v in row.values() if v), 
            reverse=True
        )
        most_complete_rows = data_with_completeness[:count // 2]

        # Always include first, middle, and last rows
        sample_indices = {0, 1, 2, len(data) // 2, len(data) - 3, len(data) - 2, len(data) - 1}
        final_sample_dict = {i: data[i] for i in sorted(list(sample_indices)) if i < len(data)}

        # Add most complete rows without duplicates
        for row in most_complete_rows:
            if row not in final_sample_dict.values():
                final_sample_dict[data.index(row)] = row
        
        return list(final_sample_dict.values())[:count]

    async def _call_ai_for_plan(
        self, 
        prompt: str, 
        headers: List[str], 
        sample_data: List[Dict],
        importer=None
    ) -> Optional[Dict]:
        """
        NEW SIMPLIFIED APPROACH: AI's ONLY job is to translate user request into specific cell changes.
        Uses Chain of Thought reasoning for better accuracy and predictability.
        
        Returns JSON with:
        - description: User-facing summary
        - transformations: List of specific cell changes (empty if no changes needed)
        """
        if not self.groq_api_key:
            logger.warning("Groq API key not configured")
            return None

        # Build validation context from importer rules
        validation_context = ""
        if importer and importer.fields:
            validation_context = "\n\n**DATA VALIDATION RULES:**\nThis data must comply with these field requirements:\n"
            for field in importer.fields:
                field_rules = f"  • {field.get('name', 'Unknown')}: {field.get('type', 'text')} type"
                if field.get('required'):
                    field_rules += ", REQUIRED"
                if field.get('not_blank'):
                    field_rules += ", cannot be blank"
                if field.get('example'):
                    field_rules += f", example: '{field.get('example')}'"
                validation_context += f"\n{field_rules}"

        ai_prompt = f"""
You are a meticulous data transformation specialist. Your ONLY task is to translate a user's request into a specific, structured list of cell changes.

**CONTEXT:**
- Spreadsheet Headers: {headers}
- Representative Sample Data (showing patterns - actual dataset may have thousands of rows):
{json.dumps(sample_data, indent=2)}
{validation_context}

**USER REQUEST:** "{prompt}"

**CHAIN OF THOUGHT REASONING (YOUR INTERNAL PROCESS):**
1. **Analyze Intent:** First, think step-by-step about what the user wants to achieve. Are they asking to modify data, or are they asking a question/chatting?
2. **Identify Targets:** If it's a modification request, pinpoint:
   - WHICH exact column(s) need changes
   - WHICH rows are affected (specific range, condition, or ALL rows)
   - WHAT the current values look like
   - WHAT the new values should become
3. **Formulate Plan:** Create a mental plan for each cell that needs to be changed:
   - Determine the exact row index (0-based: first row = 0, second row = 1, etc.)
   - Identify the column name (must match headers exactly)
   - Calculate the exact new value
4. **Construct JSON:** Based on your plan, build the final JSON output.

**CRITICAL RULES:**
- Row indexing is 0-based: First data row = 0, second row = 1, etc.
- Column names MUST exactly match the headers provided above
- If user specifies "first 5 rows", that's rows 0, 1, 2, 3, 4
- If user says "rows 100 to 200", that's rows 100-199 (200 is exclusive)
- If no specific range is mentioned, consider ALL rows in the dataset
- Be precise with string formatting (quotes, case sensitivity, spaces)
- For questions, greetings, or non-transformation requests, return empty transformations list

**FINAL OUTPUT REQUIREMENTS:**
Your response MUST be a single JSON object. Do NOT include your reasoning in the final output. The structure must be:
```json
{{
    "description": "A brief, user-facing summary of the changes you will make. If no changes are made, explain why.",
    "transformations": [
        {{
            "row_index": 0,
            "column": "exact_column_name",
            "new_value": "the_new_value"
        }}
    ]
}}
```

**EXAMPLE OUTPUTS:**

For "Change all 1s to 'yes' in the status column":
```json
{{
    "description": "Converting all '1' values to 'yes' in the status column",
    "transformations": [
        {{"row_index": 0, "column": "status", "new_value": "yes"}},
        {{"row_index": 5, "column": "status", "new_value": "yes"}},
        {{"row_index": 12, "column": "status", "new_value": "yes"}}
    ]
}}
```

For "Hello, how are you?":
```json
{{
    "description": "I'm here to help you transform your data! To make changes, tell me specifically what you'd like to modify (e.g., 'change all dates to MM/DD/YYYY format', 'replace empty cells with N/A').",
    "transformations": []
}}
```

For "Make the first 3 rows have 'URGENT' in the priority column":
```json
{{
    "description": "Setting priority to 'URGENT' for the first 3 rows",
    "transformations": [
        {{"row_index": 0, "column": "priority", "new_value": "URGENT"}},
        {{"row_index": 1, "column": "priority", "new_value": "URGENT"}},
        {{"row_index": 2, "column": "priority", "new_value": "URGENT"}}
    ]
}}
```

**YOUR SOLE OUTPUT IS THE JSON OBJECT DESCRIBED ABOVE.**

Now, perform your Chain of Thought reasoning and provide the final JSON output:
"""

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    self.groq_api_url,
                    headers={
                        "Authorization": f"Bearer {self.groq_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": "llama-3.3-70b-versatile",  # Updated to non-deprecated model
                        "messages": [{"role": "user", "content": ai_prompt}],
                        "temperature": 0.1,  # Low temperature for consistency
                        "max_tokens": 8000,  # Enough for large transformation lists
                        "response_format": {"type": "json_object"}  # Ensure JSON output
                    }
                )
                
            response.raise_for_status()
            ai_response = response.json()
            
            # Extract and parse the AI's JSON response
            content = ai_response['choices'][0]['message']['content']
            parsed_result = json.loads(content)
            
            # Validate the structure
            if 'description' not in parsed_result:
                logger.error("AI response missing 'description' field")
                return None
                
            if 'transformations' not in parsed_result:
                logger.warning("AI response missing 'transformations' field, assuming empty list")
                parsed_result['transformations'] = []
            
            # Validate each transformation
            valid_transformations = []
            for i, trans in enumerate(parsed_result.get('transformations', [])):
                if not all(k in trans for k in ['row_index', 'column', 'new_value']):
                    logger.warning(f"Skipping invalid transformation #{i}: missing required fields")
                    continue
                    
                if trans['column'] not in headers:
                    logger.warning(f"Skipping transformation #{i}: column '{trans['column']}' not in headers")
                    continue
                    
                if not isinstance(trans['row_index'], int) or trans['row_index'] < 0:
                    logger.warning(f"Skipping transformation #{i}: invalid row_index")
                    continue
                    
                valid_transformations.append(trans)
            
            # Replace with validated transformations
            parsed_result['transformations'] = valid_transformations
            
            logger.info(f"AI generated {len(valid_transformations)} valid transformations")
            return parsed_result
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Groq API HTTP error: {e.response.status_code} - {e.response.text[:200]}")
            return None
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse AI response as JSON: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Error calling Groq API: {str(e)}")
            return None
