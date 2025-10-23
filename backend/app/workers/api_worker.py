# app/workers/api_worker.py
"""
API worker for processing import jobs submitted via the API.

This worker is self-contained and handles the entire file processing lifecycle:
- Fetches the job details from the database.
- Retrieves the file from storage (e.g., local disk or S3).
- Parses and validates the file against the importer's schema.
- Updates the database with the final results.
"""

import logging
import pandas as pd
from typing import Dict, Any
from datetime import datetime
import asyncio
import os

from app.db.base import SessionLocal
from app.models.import_job import ImportJob, ImportStatus
from app.models.importer import Importer  # ORM model
from app.schemas.importer import Importer as ImporterSchema  # Pydantic schema
from app.utils.validator import validate_field
from app.services.s3_service import get_s3_service
from app.core.config import settings 

logger = logging.getLogger(__name__)

def process_api_import(import_job_id: str):
    """
    Worker function to process a file submitted via the API.
    This is the entry point for the RQ job.

    Args:
        import_job_id (str): The ID of the import job to process.
    """
    logger.info(f"API Worker: Starting job {import_job_id}")
    db = SessionLocal()
    job = None  # Define job here to access it in the except block

    try:
        # 1. Fetch the job and associated importer configuration
        job = db.query(ImportJob).filter(ImportJob.id == import_job_id).first()
        if not job:
            logger.warning(f"API Worker: Job {import_job_id} not found in database. Aborting.")
            return

        importer_config = db.query(Importer).filter(Importer.id == job.importer_id).first()
        if not importer_config:
            raise ValueError(f"Importer configuration {job.importer_id} not found.")

        # Build a Pydantic schema instance from the ORM importer so that
        # field-level validators (including extra_rules normalization) run.
        try:
            importer_schema = ImporterSchema.model_validate(importer_config)
        except Exception as e:
            logger.exception(f"Failed to validate importer schema for importer_id={job.importer_id}: {e}")
            raise

        # 2. Mark the job as PROCESSING
        job.status = ImportStatus.PROCESSING
        db.commit()

        # 3. Read the file from S3 or file path
        logger.info(f"API Worker: Processing job {import_job_id} with file_path: {job.file_path}")
        logger.info(f"API Worker: Job details - status: {job.status}, importer_id: {job.importer_id}")
        
        try:
            s3_service = get_s3_service()
            
            if job.file_path.startswith('s3://'):
                # Read from S3 using unified data loader for multiple formats
                logger.info(f"API Worker: Reading from S3: {job.file_path}")
                df = s3_service.download_file_as_dataframe(
                    job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                )
                if df is None:
                    raise ValueError(f"Failed to download file from S3: {job.file_path}")
            else:
                # Fallback for legacy local files
                logger.warning(f"API Worker: Attempting to read legacy local file: {job.file_path}")
                df = pd.read_csv(job.file_path, dtype=str, keep_default_na=False, na_filter=False).fillna("")
            
            # --- STEP 1: CAPTURE ORIGINAL HEADER ORDER ---
            # Capture the exact column order from the original data file.
            original_csv_headers = df.columns.tolist()
            logger.info(f"API Worker: Original file headers: {original_csv_headers}")
            # BEASTMODE: log headers and a sample row
            logger.info("[BEASTMODE] original headers: %s", original_csv_headers)
            logger.info("[BEASTMODE] sample row[0]: %s", df.iloc[0].to_dict() if len(df) > 0 else {})
                
        except Exception as e:
            raise ValueError(f"Failed to parse data file: {e}")

        # 4. Handle column mapping for API imports
        # For API imports: Check if headers match and auto-create mapping if they do
        auto_created_mapping = False
        
        if not job.column_mapping:
            # No column mapping provided - check if we can auto-create one
            logger.info(f"API Worker: No column mapping provided for job {import_job_id}")
            
            # Use Pydantic-validated importer fields
            importer_fields = [f.model_dump() for f in importer_schema.fields]
            importer_field_names = {field['name'] for field in importer_fields}
            required_fields = {field['name'] for field in importer_fields if field.get('required', False)}
            
            # Get current CSV headers
            csv_headers = set(df.columns.tolist())
            logger.info(f"API Worker: CSV headers: {csv_headers}")
            logger.info(f"API Worker: Importer field names: {importer_field_names}")
            logger.info(f"API Worker: Required fields: {required_fields}")
            
            # Enhanced matching logic that handles variations like singular/plural
            def normalize_header(header):
                """Normalize header for fuzzy matching"""
                h = header.lower().strip()
                # Handle common plural/singular variations
                if h.endswith('s') and len(h) > 1:
                    return h[:-1]  # Remove trailing 's'
                return h
            
            # Create smart mapping between CSV headers and importer fields
            smart_mapping = {}
            exact_matches = csv_headers.intersection(importer_field_names)
            
            # First, handle exact matches
            for field_name in exact_matches:
                smart_mapping[field_name] = field_name
            
            # Then, handle fuzzy matches for unmatched fields
            unmatched_importer_fields = importer_field_names - exact_matches
            unmatched_csv_headers = csv_headers - exact_matches
            
            for importer_field in unmatched_importer_fields:
                normalized_importer = normalize_header(importer_field)
                for csv_header in unmatched_csv_headers:
                    normalized_csv = normalize_header(csv_header)
                    if normalized_importer == normalized_csv:
                        smart_mapping[importer_field] = csv_header
                        unmatched_csv_headers.remove(csv_header)
                        break
            
            matching_headers = set(smart_mapping.keys())
            logger.info(f"API Worker: Smart matching found: {smart_mapping}")
            logger.info(f"API Worker: Matching headers between CSV and importer: {matching_headers}")
            
            # Check if all required fields have matching CSV headers (after smart matching)
            missing_required = required_fields - matching_headers
            
            if not missing_required and matching_headers:
                # Auto-create mapping using smart matching
                # Use the smart mapping we created above
                auto_mapping = smart_mapping.copy()
                
                if auto_mapping:
                    logger.info(f"API Worker: Auto-creating column mapping for {len(auto_mapping)} matching fields")
                    logger.info(f"API Worker: Auto-mapping: {auto_mapping}")
                    job.column_mapping = auto_mapping
                    auto_created_mapping = True
                    
                    # Save the auto-created mapping to the database
                    db.commit()
        
        # Apply column mapping if it exists (either provided or auto-created)
        if job.column_mapping:
            # The column mapping format is: {importer_field_name: file_column_name}
            # We need to rename file columns TO importer field names for validation
            try:
                logger.info(f"API Worker: {'Auto-created' if auto_created_mapping else 'Provided'} column mapping: {job.column_mapping}")
                logger.info(f"API Worker: Headers before mapping: {df.columns.tolist()}")
                # BEASTMODE: show reverse mapping and detect collisions
                reverse_mapping = {csv_col: importer_field for importer_field, csv_col in job.column_mapping.items()}
                logger.info("[BEASTMODE] reverse_map (orig_header -> mapped_name): %s", reverse_mapping)
                mapped_names = list(reverse_mapping.values())
                dupes = {name for name in mapped_names if mapped_names.count(name) > 1}
                if dupes:
                    logger.warning("[BEASTMODE] header mapping collisions detected: %s", list(dupes))
                # Create reverse mapping: {csv_column_name: importer_field_name}
                reverse_mapping = {csv_col: importer_field for importer_field, csv_col in job.column_mapping.items()}
                # Rename columns according to the reverse mapping
                df = df.rename(columns=reverse_mapping)
                logger.info(f"API Worker: Headers after mapping: {df.columns.tolist()}")
                logger.info("[BEASTMODE] headers AFTER rename: %s", df.columns.tolist())
                logger.info(f"Applied reverse column mapping: {reverse_mapping}")
            except Exception as e:
                logger.warning(f"Failed to apply column mapping: {e}")

        # 5. Final header validation after mapping
        # After applying mapping (or auto-creating it), verify all required fields are present
        if True:  # Always validate headers
            # Use Pydantic-validated importer fields to ensure extra_rules exist
            importer_fields = [f.model_dump() for f in importer_schema.fields]

            # Get the set of required field names from the importer
            required_fields = {field['name'] for field in importer_fields if field.get('required', False)}
            importer_field_names = {field['name'] for field in importer_fields}
            
            # Check if all required fields are present in the data file (after mapping)
            current_headers = set(df.columns.tolist())
            missing_required_fields = required_fields - current_headers
            
            # Check if file headers match importer field names (at least partially)
            # If there's no overlap or major mismatch, fail the import
            field_overlap = importer_field_names.intersection(current_headers)
            
            # Determine if we should fail the import
            should_fail = False
            if missing_required_fields:
                # Missing required fields - always fail
                should_fail = True
                error_msg = f"Required fields are missing: {', '.join(missing_required_fields)}"
            elif len(field_overlap) == 0:
                # No fields match at all
                should_fail = True
                error_msg = "No matching fields found between CSV and importer configuration."
            elif not auto_created_mapping and not job.column_mapping and len(field_overlap) < len(importer_field_names):
                # No mapping was provided or auto-created, and not all fields match
                should_fail = True
                error_msg = f"Only {len(field_overlap)} of {len(importer_field_names)} fields match. Please provide a column mapping."
            
            if should_fail:
                logger.error(f"API Worker: Header validation failed for job {import_job_id}. {error_msg}")
                
                # Mark job as FAILED with clear error message
                job.status = ImportStatus.FAILED
                job.error_message = error_msg
                job.row_count = len(df)
                job.processed_rows = 0
                job.error_count = len(missing_required_fields) if missing_required_fields else 1
                job.errors = []
                
                # Add specific missing field errors
                for field_name in missing_required_fields:
                    job.errors.append({
                        "row": "Header",
                        "column": field_name,
                        "message": f"Required field '{field_name}' is missing from the data file."
                    })
                
                # Add mismatch info if no required fields are missing but there's still a problem
                if not missing_required_fields and should_fail:
                    job.errors.append({
                        "row": "Header",
                        "column": "Mapping",
                        "message": error_msg
                    })
                
                db.commit()
                return  # Exit early since we can't process this file
            
            # Log successful validation
            if auto_created_mapping:
                logger.info(f"API Worker: Headers validated successfully with auto-created mapping for job {import_job_id}")
            elif job.column_mapping:
                logger.info(f"API Worker: Headers validated successfully with provided mapping for job {import_job_id}")
            else:
                logger.info(f"API Worker: Headers validated successfully (exact match) for job {import_job_id}")

        # Column mapping is now handled above in step 4 with auto-creation support

        # 5. Validate data row by row
        errors = []
        job.row_count = len(df)
        
        # Create a map for quick field config lookups using the validated fields
        # Use the Pydantic field models directly (as cleaned dicts)
        field_map = {f.name: f.model_dump() for f in importer_schema.fields}
        # BEASTMODE: log final field_map keys and per-column extra_rules
        try:
            logger.info("[BEASTMODE] final field_map keys (to validate): %s", list(field_map.keys()))
            for k, cfg in field_map.items():
                logger.info("[BEASTMODE] field rule for '%s': extra_rules=%s", k, cfg.get('extra_rules'))
        except Exception:
            logger.exception("[BEASTMODE] failed to log field_map details")

        # First, check for missing required columns (structural issues)
        missing_required_columns = []
        for field_name, field_config in field_map.items():
            if field_name not in df.columns and field_config.get('required'):
                missing_required_columns.append(field_name)

        # Add structural errors (once per missing column, not per row)
        for missing_column in missing_required_columns:
            errors.append({
                "row": "Header",
                "column": missing_column,
                "message": f"Required column '{missing_column}' is missing from the CSV file."
            })

        # Now validate row data (only for columns that exist)
        for index, row in df.iterrows():
            for field_name, field_config in field_map.items():
                # Skip validation for missing columns (already handled above)
                if field_name not in df.columns:
                    continue

                value = row[field_name]

                # Pass the clean field_config dict directly. It already contains
                # a top-level `extra_rules` key (normalized by Pydantic).
                error_message = validate_field(value, field_config)

                if error_message:
                    errors.append({
                        "row": index + 1,  # +1 to convert 0-based index to 1-based row number
                        "column": field_name,
                        "value": str(value),
                        "message": error_message
                    })

        # 6. Finalize the job and save results
        # Count unique rows with errors and structural errors first
        error_rows = set()
        structural_errors = 0
        
        for error in errors:
            if error.get("row") == "Header":
                structural_errors += 1
            else:
                error_rows.add(error.get("row"))
        
        # Set appropriate status based on validation results
        if structural_errors > 0 or len(error_rows) > 0:
            job.status = ImportStatus.UNCOMPLETED  # Has errors, needs user review
        else:
            job.status = ImportStatus.COMPLETED  # All data is valid
        
        job.processed_rows = job.row_count
        
        # If there are structural errors (missing required columns), 
        # all rows are considered invalid
        if structural_errors > 0:
            job.error_count = job.row_count
        else:
            job.error_count = len(error_rows)
            
        job.errors = errors  # Assumes your 'errors' column is a JSON type
        
        logger.info(f"API Worker: Job {import_job_id} completed. Rows: {job.row_count}, Error Rows: {job.error_count}, Total Errors: {len(errors)}")

        # Commit the job status first
        db.commit()
        
        # --- EFFICIENT DATA SEPARATION (DONE ONCE) ---
        # Separate valid and invalid data based on errors - do this once and reuse
        valid_df = df.copy()  # Start with all data
        invalid_df = None
        error_row_indices = set()  # Initialize here so it's always defined
        has_structural_errors = False
        
        if errors:
            # Get row indices that have errors
            for error in errors:
                if error.get("row") == "Header":
                    has_structural_errors = True
                    break
                elif isinstance(error.get("row"), int):
                    # Convert from 1-based row number to 0-based pandas index
                    error_row_indices.add(error["row"] - 1)
            
            if has_structural_errors:
                # All data is considered invalid due to structural issues
                invalid_df = df.copy()
                valid_df = pd.DataFrame()  # Empty valid data
                logger.info(f"Structural errors found - all {len(df)} rows marked as invalid")
            elif error_row_indices:
                # Separate based on error indices
                invalid_mask = df.index.isin(error_row_indices)
                valid_df = df[~invalid_mask].copy()
                invalid_df = df[invalid_mask].copy()
                logger.info(f"Separated into {len(valid_df)} valid and {len(invalid_df)} invalid rows")
        
        # --- SAVE TO S3 ---
        # 6. Save the processed data to new files in S3
        s3_service = get_s3_service()
        bucket_name = settings.S3_BUCKET_NAME

        valid_rows_key = f"processed/{job.id}_valid.csv"
        invalid_rows_key = f"processed/{job.id}_invalid.csv"
        
        # --- STEP 2: APPLY ORIGINAL HEADER ORDER ---
        # Determine the final column order based on the original CSV headers
        # and the mapping that was applied.
        final_ordered_headers = original_csv_headers
        if job.column_mapping:
            # Translate the original header order to the new, mapped header order
            final_ordered_headers = [job.column_mapping.get(h, h) for h in original_csv_headers]
            logger.info(f"API Worker: Original CSV headers: {original_csv_headers}")
            logger.info(f"API Worker: Column mapping: {job.column_mapping}")
            logger.info(f"API Worker: Final ordered headers after mapping: {final_ordered_headers}")
        else:
            logger.info(f"API Worker: No column mapping - using original headers: {final_ordered_headers}")

        # Save the DataFrames to S3
        if not valid_df.empty:
            # Re-order the DataFrame columns to match the original file's order
            # We also filter to ensure we only try to order columns that actually exist in the DataFrame
            existing_valid_headers = [h for h in final_ordered_headers if h in valid_df.columns]
            valid_df = valid_df[existing_valid_headers]
            logger.info(f"API Worker: Reordered valid_df columns: {valid_df.columns.tolist()}")
            
            if s3_service.save_dataframe_to_s3(valid_df, valid_rows_key):
                job.valid_csv_path = f"s3://{bucket_name}/{valid_rows_key}"
                logger.info(f"Saved valid rows to {job.valid_csv_path}")
            else:
                logger.warning(f"Failed to save valid rows to S3: {valid_rows_key}")

        if invalid_df is not None and not invalid_df.empty:
            # Do the same for the invalid data file
            existing_invalid_headers = [h for h in final_ordered_headers if h in invalid_df.columns]
            invalid_df = invalid_df[existing_invalid_headers]
            logger.info(f"API Worker: Reordered invalid_df columns: {invalid_df.columns.tolist()}")
            
            if s3_service.save_dataframe_to_s3(invalid_df, invalid_rows_key):
                job.invalid_csv_path = f"s3://{bucket_name}/{invalid_rows_key}"
                logger.info(f"Saved invalid rows to {job.invalid_csv_path}")
            else:
                logger.warning(f"Failed to save invalid rows to S3: {invalid_rows_key}")

        # 7. Finalize the job status and save everything to the database
        db.commit()  # This will now save the new paths and the final status
        logger.info(f"S3 file paths committed to database for job {import_job_id}")
        
        # --- UPDATE JOB STATUS AND METADATA ---
        # Status is already set above based on validation results, don't override it
        
        # Save file metadata with the ORIGINAL CSV header order
        # IMPORTANT: Store original CSV headers, NOT mapped field names
        job.file_metadata = {
            "headers": original_csv_headers,  # ALWAYS use original CSV headers for consistency
            "original_headers": original_csv_headers,  # Keep for backward compatibility
            "mapped_headers": final_ordered_headers,  # Store mapped headers separately if needed
            "column_mapping": job.column_mapping or {},  # The mapping that was applied
            "row_count": len(df),
            "processed_at": datetime.utcnow().isoformat()
        }
        
        logger.info(f"API Worker: Saved file_metadata with original headers: {original_csv_headers}")
        logger.info(f"API Worker: Mapped headers stored separately: {final_ordered_headers}")
        
        # --- SEND WEBHOOK (REUSE SEPARATED DATA) ---
        # Send webhook notification if configured (send once after processing, regardless of errors)
        if importer_config.webhook_enabled and importer_config.webhook_url:
            try:
                from app.services.import_service import import_service
                
                logger.info(f"Sending webhook for completed import job {import_job_id} (reusing separated DataFrames)")
                logger.info(f"Webhook URL: {importer_config.webhook_url}, Enabled: {importer_config.webhook_enabled}")
                
                # Prepare DataFrames for webhook - use the original separated data BEFORE reordering
                # The valid_df and invalid_df at this point have already been reordered for S3
                # We need to pass the data with actual columns to the webhook
                webhook_valid_df = df[~df.index.isin(error_row_indices)] if error_row_indices else df.copy()
                webhook_invalid_df = df[df.index.isin(error_row_indices)] if error_row_indices else pd.DataFrame()
                
                # Handle structural errors case
                if errors and any(e.get("row") == "Header" for e in errors):
                    # All data is invalid for structural errors
                    webhook_valid_df = pd.DataFrame()
                    webhook_invalid_df = df.copy()
                
                logger.info(f"Webhook DataFrames - valid: {len(webhook_valid_df)} rows with columns {webhook_valid_df.columns.tolist() if not webhook_valid_df.empty else []}, invalid: {len(webhook_invalid_df)} rows")
                
                
                # Use the optimized API-specific webhook method (NO FILE I/O)
                # Run the async webhook function in a new event loop
                try:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    webhook_sent = loop.run_until_complete(
                            import_service.send_webhook_for_api_import(
                            db=db,
                            import_job=job,
                            importer=importer_config,  # Use ORM object, not Pydantic schema
                            valid_data_df=webhook_valid_df,      # Clean data with actual columns
                            failed_data_df=webhook_invalid_df    # Invalid data with actual columns
                        )
                    )
                    
                    if webhook_sent:
                        logger.info(f"API webhook sent successfully for import job {import_job_id}")
                    else:
                        logger.warning(f"API webhook delivery failed for import job {import_job_id}")
                        
                finally:
                    loop.close()
                
            except Exception as webhook_error:
                logger.error(f"Failed to send API webhook for import job {import_job_id}: {webhook_error}")
                # Don't fail the entire job if webhook fails
                # Rollback the session if there was an error to clear the bad state
                if db and db.is_active:
                    db.rollback()

    except Exception as e:
        logger.error(f"API Worker: Critical error processing job {import_job_id}: {e}", exc_info=True)
        if job:
            # If any exception occurs, mark the job as FAILED
            job.status = ImportStatus.FAILED
            job.error_message = str(e)
    
    finally:
        if db and job:
            # Always commit the final state (COMPLETED or FAILED)
            db.commit()
        if db:
            # Always close the database session
            db.close()
