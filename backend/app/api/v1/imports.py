import json
import logging
import os
import shutil
import io
import uuid
import uuid as uuidlib
from datetime import datetime
from typing import List, Dict, Any, Optional

import pandas as pd
import boto3
# Removed unused import: from botocore.exceptions import ClientError

from fastapi import APIRouter, Depends, HTTPException, Form, UploadFile, File, status, Request, BackgroundTasks
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, validator, ValidationError, field_validator
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from sqlalchemy.orm.attributes import flag_modified #mychange
from sqlalchemy.orm import joinedload

from app.auth.users import get_current_active_user
from app.auth.api_key_auth import get_current_user_by_api_key
from app.db.base import get_db, SessionLocal
from app.models.user import User
from app.models.importer import Importer
from app.models.import_job import ImportJob, ImportStatus, ImportSource
from app.schemas.import_job import (
    ImportJob as ImportJobSchema,
    ImportByKeyRequest,
    ImportProcessResponse,
)
from app.services.import_service import (
    import_service,
    log_import_started,
)
from app.services.importer import get_importer_by_key
from app.services.queue import enqueue_job
from app.services.validation_service import validation_service
from app.services.s3_service import get_s3_service
from app.services.plan_limits import plan_limits_service
from app.services.ai_service import AIService
from app.core.config import settings

logger = logging.getLogger(__name__)

# Router for user-authenticated endpoints
router = APIRouter()


# API key authenticated router
api_key_router = APIRouter(tags=["API Key Imports"])

# Endpoint 1: Submit File for Validation (API Key Auth)
@api_key_router.post("", status_code=status.HTTP_202_ACCEPTED)
async def submit_import_job(
    request: Request,
    importerId: str = Form(...),
    file: UploadFile = File(...),
    columnMapping: Optional[str] = Form(None),  # JSON string for column mappings
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_by_api_key),
):
    """
    Accepts a file and puts it in a queue for processing.
    
    Parameters:
    - importerId: The ID of the importer configuration to use
    - file: The CSV file to process
    - columnMapping: Optional JSON string mapping CSV columns to importer fields
                    Format: {"csv_column_name": "importer_field_name", ...}
                    Example: {"Name": "full_name", "Email Address": "email"}
    """
    # Validate importerId
    if not importerId or not importerId.strip():
        raise HTTPException(status_code=400, detail="Importer ID is required and cannot be empty")
    
    try:
        uuid.UUID(importerId)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid importer ID format. Must be a valid UUID.")
    
    # Check importer ownership
    importer = db.query(Importer).filter(Importer.id == importerId, Importer.user_id == current_user.id).first()
    if not importer:
        raise HTTPException(status_code=403, detail="You do not have access to this importer.")
    
    # Get file size for plan validation
    file.file.seek(0, 2)  # Seek to end of file
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to beginning
    
    # Check plan limits before processing
    can_import, error_message = plan_limits_service.can_create_import(db, current_user, file_size)
    if not can_import:
        logger.warning(f"User {current_user.id} ({current_user.plan_type}) cannot create import: {error_message}")
        raise HTTPException(status_code=403, detail=error_message)

    # Parse column mapping if provided
    column_mapping_dict = {}
    if columnMapping:
        try:
            column_mapping_dict = json.loads(columnMapping)
            if not isinstance(column_mapping_dict, dict):
                raise HTTPException(status_code=400, detail="Column mapping must be a JSON object")
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in column mapping")

    # If no column mapping is provided, check if file headers match importer field names
    if not columnMapping:
        try:
            # Read just the headers from the file
            contents = await file.read()
            await file.seek(0)  # Reset file pointer for later use
            
            # Determine file type from extension
            file_ext = os.path.splitext(file.filename)[1].lower()
            
            if file_ext in ['.xlsx', '.xls', '.ods']:
                # For Excel files, we'll validate headers during processing
                # since we need to read the entire file to get headers
                logger.info(f"Excel file detected: {file.filename}, headers will be validated during processing")
            else:
                # For CSV files, use pandas to read just the header
                df_headers = pd.read_csv(io.StringIO(contents.decode('utf-8')), nrows=0)
                csv_headers = set(df_headers.columns.tolist())
                
                # Get importer field names
                importer_field_names = {field['name'] for field in importer.fields}
                required_fields = {field['name'] for field in importer.fields if field.get('required', False)}
                
                # Check for missing required fields
                missing_required = required_fields - csv_headers
                
                # Check overlap between CSV headers and importer fields
                overlap = importer_field_names.intersection(csv_headers)
                
                # If there are missing required fields or less than 50% overlap, warn the user
                if missing_required or (len(overlap) < len(importer_field_names) * 0.5):
                    warning_msg = "CSV headers do not match the expected importer field names. Please provide a column mapping or ensure your CSV headers match the importer configuration."
                    # Add this information to the import job so it can be shown in the UI
                    column_mapping_dict["_header_warning"] = warning_msg
                
        except Exception as e:
            logger.warning(f"Could not validate file headers: {e}")
            # Continue with import even if we can't validate headers

    # Save uploaded file to S3
    try:
        s3_service = get_s3_service()
        
        # Generate a proper UUID for the import job
        import_uuid = uuidlib.uuid4()
        import_id = str(import_uuid)
        
        # Create S3 key for the uploaded file
        file_ext = os.path.splitext(file.filename)[1]
        s3_key = f"uploads/{import_uuid.hex}{file_ext}"
        
        # Upload file to S3
        file.file.seek(0)  # Reset file pointer
        success = s3_service.upload_file(
            file.file, 
            s3_key, 
            content_type=file.content_type
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload file to S3")
        
        # Store S3 URI as file path
        file_path = f"s3://{settings.S3_BUCKET_NAME}/{s3_key}"
        
    except Exception as e:
        logger.error(f"Error uploading file to S3: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")

    # Create the job record with a PENDING status
    import_job = ImportJob(
        id=import_uuid,  # Use the UUID object directly
        user_id=current_user.id,
        importer_id=importer.id,
        file_name=file.filename,
        file_path=file_path,
        file_type=file_ext.lstrip('.'),
        status=ImportStatus.PENDING,
        row_count=0,
        processed_rows=0,
        error_count=0,
        column_mapping=column_mapping_dict if column_mapping_dict else None,
        created_at=datetime.utcnow(),
    )
    db.add(import_job)
    db.commit()
    db.refresh(import_job)

    try:
        # Step 2: Enqueue the job for background processing
        enqueue_job('app.workers.api_worker.process_api_import', import_job_id=import_id)
        logger.info(f"Import job {import_id} enqueued for processing")
        return {
            "importId": import_id,
            "status": "processing",
            "message": "File received and is scheduled for processing."
        }
    except Exception as e:
        # If enqueuing fails, mark job as FAILED
        import_job.status = ImportStatus.FAILED
        import_job.error_message = "Failed to enqueue job for processing."
        db.commit()
        # Clean up the file if it was saved
        if os.path.exists(file_path):
            os.remove(file_path)
        logger.error(f"Failed to schedule import job: {e}")
        raise HTTPException(status_code=500, detail="Failed to schedule import job.")


# Endpoint 2: Check Import Status & Get Results (API Key Auth)
@api_key_router.get("/{import_id}")
async def get_import_status(
    import_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user_by_api_key),
):
    """
    Check the status and results of an import job.
    """
    import_job = db.query(ImportJob).filter(ImportJob.id == import_id, ImportJob.user_id == current_user.id).first()
    if not import_job:
        raise HTTPException(status_code=404, detail="Import job not found.")

    # If still processing
    if import_job.status in [ImportStatus.PENDING, ImportStatus.PROCESSING, ImportStatus.VALIDATING]:
        return {
            "importId": import_job.id,
            "status": "processing"
        }

    # If completed
    if import_job.status == ImportStatus.COMPLETED:
        # Example result structure
        results = {
            "totalRows": import_job.row_count,
            "validRows": (import_job.row_count or 0) - (import_job.error_count or 0),
            "errorRows": import_job.error_count or 0,
            "errors": import_job.errors or []
        }

        # Add this new logic
        structural_errors = [e for e in (import_job.errors or []) if e.get("row") == "Header"]
        if structural_errors:
            results["status_details"] = "Import failed due to missing required columns."

        return {
            "importId": import_job.id,
            "status": "completed",
            "results": results
        }

    # If failed or other
    response_data = {
        "importId": import_job.id,
        "status": str(import_job.status),
        "error": import_job.error_message or "Import failed."
    }
    
    # Add header warning if present
    if import_job.column_mapping and "_header_warning" in import_job.column_mapping:
        response_data["header_warning"] = import_job.column_mapping["_header_warning"]
        
    return response_data


# Pydantic models for execute import request
class ExecuteImportRequest(BaseModel):
    import_job_id: Optional[uuid.UUID] = None  # Optional for backward compatibility
    importer_id: str
    headers: List[str]
    mapping: Dict[str, Optional[str]] # Allow for null/unmapped columns
    field_inclusion: Dict[str, bool]
    csv_data: List[Dict[str, Any]]
    validation_results: List[Dict[str, Any]] = []
    conflict_count: int = 0
    is_valid: bool = True
    total_rows: int = 0
    
    @field_validator('importer_id')
    @classmethod
    def validate_importer_id(cls, v: str) -> str:
        """Validates that the importer_id is a non-empty, valid UUID string."""
        if not v or not v.strip():
            raise ValueError('Importer ID cannot be empty')
        try:
            # We just validate the format; the endpoint will use the string.
            uuid.UUID(v)
        except ValueError:
            raise ValueError('Importer ID must be a valid UUID format')
        return v.strip()

class ExecuteImportResponse(BaseModel):
    success: bool
    import_id: str
    imported_rows: int
    failed_rows: int
    message: str
    webhook_status: str = "pending"



@router.get("", response_model=List[ImportJobSchema])
async def read_import_jobs(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user),
):
    """
    Retrieve import jobs for the current user.
    
    Returns only imports created by the current user, whether they were created
    via the portal interface or the API key interface.

    Parameters:
        db: Database session
        skip: Number of records to skip (pagination)
        limit: Maximum number of records to return (pagination)
        current_user: Authenticated user making the request

    Returns:
        List of import job records for the current user only
    """
    return import_service.get_import_jobs(db, str(current_user.id), skip, limit)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_import_file(
    importer_id: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Upload a file for portal import and save it to S3.
    
    This is Step 1 of the portal import process:
    1. Upload file to S3 immediately
    2. Create ImportJob record with S3 path
    3. Return import_job_id for frontend to continue with mapping
    
    Parameters:
        importer_id: ID of the importer configuration to use
        file: The CSV file to upload
        db: Database session
        current_user: Authenticated user making the request
        
    Returns:
        Import job record with S3 file path
    """
    # Validate importer_id
    if not importer_id or not importer_id.strip():
        raise HTTPException(status_code=400, detail="Importer ID is required and cannot be empty")
    
    try:
        uuid.UUID(importer_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid importer ID format. Must be a valid UUID.")
    
    # Check importer ownership
    importer = db.query(Importer).filter(Importer.id == importer_id, Importer.user_id == current_user.id).first()
    if not importer:
        raise HTTPException(status_code=403, detail="You do not have access to this importer.")

    # Validate file type
    allowed_extensions = ['.csv', '.xlsx', '.xls', '.ods']
    if not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
        raise HTTPException(status_code=400, detail="Only CSV, XLS, XLSX, and ODS files are supported")
    
    # Get file size for plan validation
    file.file.seek(0, 2)  # Seek to end of file
    file_size = file.file.tell()
    file.file.seek(0)  # Reset to beginning
    
    # Check plan limits before processing
    can_import, error_message = plan_limits_service.can_create_import(db, current_user, file_size)
    if not can_import:
        logger.warning(f"User {current_user.id} ({current_user.plan_type}) cannot create import: {error_message}")
        raise HTTPException(status_code=403, detail=error_message)

    # Upload file to S3
    try:
        s3_service = get_s3_service()
        
        # Generate a proper UUID for the import job
        import_uuid = uuid.uuid4()
        
        # Create S3 key for the uploaded file
        file_ext = os.path.splitext(file.filename)[1]
        s3_key = f"uploads/{import_uuid.hex}{file_ext}"
        
        # Upload file to S3
        file.file.seek(0)  # Reset file pointer
        success = s3_service.upload_file(
            file.file, 
            s3_key, 
            content_type=file.content_type
        )
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to upload file to S3")
        
        # Store S3 URI as file path
        file_path = f"s3://{settings.S3_BUCKET_NAME}/{s3_key}"
        
    except Exception as e:
        logger.error(f"Error uploading file to S3: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")

    # Create the job record with PENDING_VALIDATION status (waiting for column mapping)
    # This is PORTAL-ONLY. API imports go straight to PENDING status.
    import_job = ImportJob(
        id=import_uuid,
        user_id=current_user.id,
        importer_id=importer.id,
        file_name=file.filename,
        file_path=file_path,
        file_type=file_ext.lstrip('.'),
        import_source=ImportSource.PORTAL,  # Portal import - created via web UI
        status=ImportStatus.PENDING_VALIDATION,  # Portal jobs start as PENDING_VALIDATION (wizard incomplete)
        row_count=0,  # Will be set by worker
        processed_rows=0,
        error_count=0,
        column_mapping=None,  # Will be set by frontend after mapping
        created_at=datetime.utcnow(),
    )
    db.add(import_job)
    db.commit()
    db.refresh(import_job)

    logger.info(f"Portal file uploaded to S3 and job created: {import_job.id}")
    
    return {
        "id": str(import_job.id),
        "file_name": import_job.file_name,
        "file_path": import_job.file_path,
        "status": str(import_job.status.value),
        "message": "File uploaded successfully. Ready for column mapping."
    }


@router.post("", response_model=ImportJobSchema)
async def create_import_job(
    importer_id: str = Form(...),  # UUID as string
    file_name: str = Form(...),
    column_mapping: str = Form(...),  # JSON string
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create a new import job and enqueue it for background processing.

    This endpoint creates an import job record in the database and then
    enqueues the job for asynchronous processing using Redis Queue.

    Parameters:
        importer_id: ID of the importer configuration to use
        file_name: Original name of the uploaded file
        column_mapping: JSON string mapping CSV columns to data fields
        db: Database session
        current_user: Authenticated user making the request

    Returns:
        The created import job record

    Raises:
        HTTPException: For validation errors, file not found, or server errors
    """
    try:
        # Parse column mapping
        column_mapping_dict = json.loads(column_mapping)

        import_job = await import_service.create_import_job(
            db=db,
            user_id=str(current_user.id),
            importer_id=importer_id,
            file_name=file_name,
            data=column_mapping_dict.get("data", []),
        )

        return import_job

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid column mapping JSON")
    except ValueError as ve:
        logger.error(f"Validation error creating import job: {str(ve)}")
        raise HTTPException(status_code=400, detail=str(ve))
    except FileNotFoundError as fnf:
        logger.error(f"File not found: {str(fnf)}")
        raise HTTPException(status_code=404, detail=str(fnf))
    except Exception as e:
        logger.error(f"Error creating import job: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error creating import job: {str(e)}"
        )


@router.get("/{import_job_id}", response_model=ImportJobSchema)
async def read_import_job(
    import_job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Retrieve a specific import job by its ID.

    This endpoint fetches details of a single import job, ensuring that
    the job belongs to the authenticated user making the request.

    Parameters:
        import_job_id: UUID of the import job to retrieve
        db: Database session
        current_user: Authenticated user making the request

    Returns:
        The requested import job record

    Raises:
        HTTPException: If the job is not found or an error occurs
    """
    try:
        import_job = import_service.get_import_job(
            db, str(current_user.id), import_job_id
        )
        if not import_job:
            raise HTTPException(status_code=404, detail="Import job not found")
        return import_job
    except Exception as e:
        logger.error(f"Error retrieving import job {import_job_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error retrieving import job: {str(e)}"
        )


@router.delete("/{import_job_id}")
async def delete_import_job(
    import_job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Delete an import job.
    
    This endpoint allows users to delete their own import jobs.
    WebhookEvents are deleted automatically via database cascade.
    
    Parameters:
        import_job_id: UUID of the import job to delete
        db: Database session
        current_user: Authenticated user making the request
        
    Returns:
        Success message
        
    Raises:
        HTTPException: If the job is not found or cannot be deleted
    """
    try:
        # Get the import job to verify ownership
        import_job = import_service.get_import_job(
            db, str(current_user.id), import_job_id
        )
        if not import_job:
            raise HTTPException(status_code=404, detail="Import job not found")
        
        # Prevent deletion of actively processing jobs
        if import_job.status in [ImportStatus.PROCESSING, ImportStatus.IMPORTING, ImportStatus.VALIDATING]:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot delete import job in {import_job.status} status. Please wait for completion."
            )
        
        # Delete associated files from S3
        try:
            s3_service = get_s3_service()
            
            # Delete uploaded file from S3
            if import_job.file_path and import_job.file_path.startswith('s3://'):
                s3_key = import_job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                s3_service.delete_file(s3_key)
                logger.info(f"Deleted uploaded file from S3: {s3_key}")
            
            # Delete valid/invalid CSV files if they exist
            if hasattr(import_job, 'valid_csv_path') and import_job.valid_csv_path:
                if import_job.valid_csv_path.startswith('s3://'):
                    s3_key = import_job.valid_csv_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                    s3_service.delete_file(s3_key)
                    logger.info(f"Deleted valid CSV from S3: {s3_key}")
            
            if hasattr(import_job, 'invalid_csv_path') and import_job.invalid_csv_path:
                if import_job.invalid_csv_path.startswith('s3://'):
                    s3_key = import_job.invalid_csv_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                    s3_service.delete_file(s3_key)
                    logger.info(f"Deleted invalid CSV from S3: {s3_key}")
            
        except Exception as s3_error:
            logger.warning(f"Failed to delete S3 files for import job {import_job_id}: {s3_error}")
            # Continue with database deletion even if S3 cleanup fails
        
        # Delete the import job from database
        # Webhook events will be cascade deleted automatically
        db.delete(import_job)
        db.commit()
        
        logger.info(f"Successfully deleted import job {import_job_id} and its webhook events")
        return {"success": True, "message": "Import job deleted successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting import job {import_job_id}: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Error deleting import job: {str(e)}"
        )


@router.post("/view/{import_id}/resend-webhook")
async def resend_webhook(
    import_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Manually re-triggers a webhook for a completed import job.
    
    This endpoint intelligently handles webhook resending based on import type:
    - Portal imports: Normal use case for manual webhook sending
    - API imports: Shows warning about potential duplicates since webhooks are auto-sent
    """
    job = db.query(ImportJob).filter(ImportJob.id == import_id, ImportJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found.")
    
    # Allow webhooks for both COMPLETED and UNCOMPLETED (portal-managed) jobs
    if job.status not in [ImportStatus.COMPLETED, ImportStatus.UNCOMPLETED]:
        raise HTTPException(status_code=400, detail="Webhooks can only be sent for completed or uncompleted (portal) jobs.")

    importer_config = db.query(Importer).filter(Importer.id == job.importer_id).first()
    if not importer_config or not importer_config.webhook_enabled or not importer_config.webhook_url:
        raise HTTPException(status_code=400, detail="Webhook is not configured for this importer.")

    # RELIABLE DETECTION: Use import_source field (set at creation time)
    is_api_import = job.import_source == ImportSource.API
    
    # Check webhook history to see if any webhooks were already sent
    webhook_count = len(job.webhook_events) if hasattr(job, 'webhook_events') and job.webhook_events else 0
    
    if is_api_import and webhook_count > 0:
        # API import with existing webhooks - show strong warning
        logger.warning(f"Manual webhook resend for API import {job.id} which already has {webhook_count} webhook(s). Will reuse existing webhook event to avoid duplicates.")
        response_message = f"Webhook resent successfully. WARNING: This API import already had {webhook_count} webhook notification(s). Reused existing webhook to avoid duplicates."
        warning_type = "duplicate_likely"
    elif is_api_import:
        # API import but no webhook history - unusual but allowed
        logger.info(f"Manual webhook resend for API import {job.id} with no previous webhooks.")
        response_message = "Webhook sent successfully. Note: This is an API import - webhooks are typically sent automatically."
        warning_type = "api_import"
    elif webhook_count > 0:
        # Portal import with existing webhooks - normal resend scenario
        logger.info(f"Manual webhook resend for portal import {job.id}. Previous webhooks: {webhook_count}")
        response_message = f"Webhook sent successfully. This is resend #{webhook_count + 1}."
        warning_type = "resend"
    else:
        # Portal import, first webhook - normal scenario
        logger.info(f"Manual webhook send for portal import {job.id} (first webhook).")
        response_message = "Webhook sent successfully."
        warning_type = None

    # Send webhook notification - always create new webhook with current data
    try:
        from app.services.import_service import import_service
        
        # Always send a new webhook notification with current data state
        # This ensures users get the latest/modified version of their data
        logger.info(f"Sending webhook notification for job {job.id} (type: {'API' if is_api_import else 'portal'})")
        webhook_sent = await import_service.send_webhook_notification(db=db, import_job=job, importer=importer_config)
        
        if webhook_sent:
            return {
                "message": response_message,
                "import_type": "api" if is_api_import else "portal",
                "webhook_count": webhook_count + 1,  # Always increment since we create new webhook events
                "warning_type": warning_type
            }
        else:
            return {
                "message": "Webhook sending failed. Check webhook configuration.",
                "import_type": "api" if is_api_import else "portal",
                "webhook_count": webhook_count,
                "warning_type": warning_type
            }
            
    except Exception as e:
        logger.error(f"Error sending webhook for job {job.id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to send webhook: {str(e)}")




@router.get("/{import_job_id}/download-csv")
async def download_import_csv(
    import_job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Download processed data as CSV file.
    
    This endpoint allows users to download the processed data from an import job
    as a CSV file, ensuring that the job belongs to the authenticated user.
    
    Parameters:
        import_job_id: UUID of the import job to download
        db: Database session
        current_user: Authenticated user making the request
        
    Returns:
        StreamingResponse with CSV file
        
    Raises:
        HTTPException: If the job is not found, has no processed data, or an error occurs
    """
    try:
        # Get the import job
        import_job = import_service.get_import_job(
            db, str(current_user.id), import_job_id
        )
        if not import_job:
            raise HTTPException(status_code=404, detail="Import job not found")
        
    # Allow downloads for UNCOMPLETED and COMPLETED imports as long as processed_data exists
    # (UNCOMPLETED jobs in the portal flow may already have processed_data available for download)
    # No special blocking by status here.
        
        # Check if processed data exists
        if not import_job.processed_data:
            raise HTTPException(status_code=400, detail="No processed data available for download")
        
        # Convert processed data to CSV
        
        # Handle the processed_data structure
        processed_data = import_job.processed_data
        
        # Extract data from the processed_data structure
        data = []
        
        if isinstance(processed_data, dict):
            # Check if it has the simplified structure with just 'data'
            if 'data' in processed_data:
                data_raw = processed_data['data']
                # If data is a string (JSON), parse it
                if isinstance(data_raw, str):
                    try:
                        data = json.loads(data_raw)
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse data JSON string: {data_raw}")
                        data = []
                elif isinstance(data_raw, list):
                    data = data_raw
            # Check for other possible keys that might contain the data
            elif 'valid_records' in processed_data:
                data = processed_data['valid_records']
            elif 'records' in processed_data:
                data = processed_data['records']
            elif 'data' in processed_data:
                data = processed_data['data']
            else:
                # If it's a dict but doesn't have expected keys, check if it contains list data directly
                # Look for any key that contains a list of dictionaries
                for key, value in processed_data.items():
                    if isinstance(value, list) and len(value) > 0 and isinstance(value[0], dict):
                        data = value
                        break
                
                # If still no data found, try to use the dict itself as a single record
                if not data and processed_data:
                    data = [processed_data]
        elif isinstance(processed_data, list):
            data = processed_data
        else:
            # Fallback: convert to list format
            data = [{"data": str(processed_data)}]
        
        # Handle empty data
        if not data:
            data = [{"message": "No data available"}]
        
        # Ensure all items are dictionaries and clean the data for CSV export
        normalized_data = []
        for item in data:
            if isinstance(item, dict):
                # Create a clean record for CSV export
                clean_item = {}
                for key, value in item.items():
                    # Convert any complex types to simple strings or numbers
                    if isinstance(value, (dict, list)):
                        clean_item[key] = json.dumps(value) if value else ""
                    elif value is None:
                        clean_item[key] = ""
                    else:
                        clean_item[key] = str(value)
                normalized_data.append(clean_item)
            else:
                # Convert non-dict items to dict
                normalized_data.append({"value": str(item)})
        
        # Create DataFrame with error handling, preserving original CSV column order
        try:
            df = pd.DataFrame(normalized_data)
            
            # Apply the same column ordering logic as the data view endpoint
            ordered_headers = []
            original_headers = []
            column_mapping = {}
            
            # Extract original headers from file_metadata
            if import_job.file_metadata and isinstance(import_job.file_metadata, dict):
                original_headers = import_job.file_metadata.get('headers', [])
            
            # Extract column mapping (CSV column -> field mapping)
            if import_job.column_mapping and isinstance(import_job.column_mapping, dict):
                column_mapping = import_job.column_mapping
            
            # If we have both original headers and mapping, reorder according to CSV order
            if original_headers and column_mapping:
                # Create reverse mapping: CSV column -> mapped field name
                csv_to_field = {}
                for field_name, csv_column in column_mapping.items():
                    if csv_column:  # Only include mapped columns
                        csv_to_field[csv_column] = field_name
                
                # Order headers according to original CSV column order
                available_fields = set(df.columns.tolist())
                for csv_column in original_headers:
                    if csv_column in csv_to_field:
                        field_name = csv_to_field[csv_column]
                        if field_name in available_fields:
                            ordered_headers.append(field_name)
                            available_fields.remove(field_name)
                
                # Add any remaining fields that weren't in the original mapping
                ordered_headers.extend(sorted(available_fields))
                
                # Reorder DataFrame columns
                df = df[ordered_headers]
            
        except Exception as df_error:
            logger.warning(f"Failed to create DataFrame from processed data: {str(df_error)}")
            # Fallback: create a simple DataFrame with the raw data
            df = pd.DataFrame([{"raw_data": str(processed_data)}])
        
        # Determine the original file type and format accordingly
        original_file_type = getattr(import_job, 'file_type', 'csv').lower()
        original_filename = import_job.file_name or "import_data"
        
        if original_file_type in ['xlsx', 'xls', 'ods']:
            # Export as Excel format
            import io
            excel_buffer = io.BytesIO()
            
            if original_file_type == 'xlsx':
                df.to_excel(excel_buffer, index=False, engine='openpyxl')
                file_extension = '.xlsx'
                media_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            elif original_file_type == 'xls':
                df.to_excel(excel_buffer, index=False, engine='xlwt')
                file_extension = '.xls'
                media_type = 'application/vnd.ms-excel'
            elif original_file_type == 'ods':
                df.to_excel(excel_buffer, index=False, engine='odf')
                file_extension = '.ods'
                media_type = 'application/vnd.oasis.opendocument.spreadsheet'
            
            excel_buffer.seek(0)
            excel_content = excel_buffer.read()
            
            filename = f"{original_filename.rsplit('.', 1)[0]}_processed{file_extension}"
            
            return StreamingResponse(
                iter([excel_content]),
                media_type=media_type,
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        else:
            # Export as CSV (default)
            csv_buffer = io.StringIO()
            df.to_csv(csv_buffer, index=False)
            csv_content = csv_buffer.getvalue()
            
            # Create response
            def generate_csv():
                yield csv_content.encode('utf-8')
            
            filename = f"{original_filename.rsplit('.', 1)[0]}_processed.csv"
            
            return StreamingResponse(
                generate_csv(),
                media_type="text/csv",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading CSV for import job {import_job_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error generating CSV: {str(e)}"
        )



def promote_api_job_to_portal_managed(import_job_id: uuid.UUID):
    """
    Background job to perform the one-time, slow operation of converting a
    file-based API job into a database-managed portal job.
    """
    db = SessionLocal()
    try:
        job = db.query(ImportJob).filter(ImportJob.id == import_job_id).first()
        if not job or job.processed_data:
            logger.info(f"Promotion worker: Job {import_job_id} not found or already promoted. Skipping.")
            return

        logger.info(f"Promotion worker: Starting promotion for API job {import_job_id}.")
        
        # This function now reads from S3 or a local path
        if job.file_path.startswith('s3://'):
            s3_service = get_s3_service()
            df = s3_service.download_file_as_dataframe(
                job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
            )
            if df is None:
                raise FileNotFoundError(f"Failed to download file from S3: {job.file_path}")
        elif os.path.exists(job.file_path):
            df = pd.read_csv(job.file_path, dtype=str, keep_default_na=False, na_filter=False).fillna("")
        else:
            raise FileNotFoundError("Original file for API job not found.")

        # 2. Apply column mapping to align headers with internal field names
        if job.column_mapping:
            df = df.rename(columns=job.column_mapping)

        # 3. Convert DataFrame to the list of dicts format
        data_as_dicts = df.to_dict(orient='records')
        
        # 4. Update the database record with simplified structure
        job.processed_data = {
            'data': data_as_dicts
        }
        # Mark as modified to ensure the change is saved
        flag_modified(job, "processed_data")
        
        # 5. Set status to UNCOMPLETED to signify it's now in the portal editing flow
        job.status = ImportStatus.UNCOMPLETED
        
        db.commit()
        logger.info(f"Promotion worker: Successfully promoted job {import_job_id}.")

    except Exception as e:
        logger.error(f"Promotion worker: Failed to promote job {import_job_id}: {e}", exc_info=True)
        if job:
            job.status = ImportStatus.FAILED
            job.error_message = "Failed to prepare data for editing."
            db.commit()
    finally:
        db.close()


def promote_api_job_for_editing(
    import_job_id: uuid.UUID, 
    pending_row_index: int = None, 
    pending_column_key: str = None, 
    pending_new_value: str = None
):
    """
    Asynchronous background task to promote an API job to database-managed and optionally apply a pending edit.
    
    This function does the heavy lifting of:
    1. Loading the entire CSV file from S3
    2. Converting it to processed_data format
    3. Optionally applying a pending cell edit
    4. Updating the job status
    
    Parameters:
        import_job_id: UUID of the import job to promote
        pending_row_index: Row index of the pending edit (optional)
        pending_column_key: Column key of the pending edit (optional)
        pending_new_value: New value for the pending edit (optional)
    """
    logger.info(f"Background task started for promotion of job {import_job_id}")
    logger.error(f"🔥 CRITICAL: Background task ACTUALLY RUNNING for job {import_job_id}")
    print(f"🔥 CRITICAL: Background task ACTUALLY RUNNING for job {import_job_id}")
    
    db = SessionLocal()
    job = None
    try:
        # Get the import job
        job = db.query(ImportJob).filter(ImportJob.id == import_job_id).first()
        if not job:
            logger.error(f"Background task: Job {import_job_id} not found.")
            return
            
        logger.info(f"Background task: Found job {import_job_id}, current status: {job.status}")
            
        if job.processed_data:
            logger.info(f"Background task: Job {import_job_id} already promoted. Skipping.")
            return
            
        if not job.file_path:
            logger.error(f"Background task: Job {import_job_id} has no file_path to promote from.")
            job.status = ImportStatus.FAILED
            job.error_message = "No file path found for promotion."
            db.commit()
            return

        logger.info(f"Background task: Starting data loading for API job {import_job_id} from {job.file_path}")
        
        # Step 1: Load data from S3 or local file (same pattern as promote_api_job_to_portal_managed)
        try:
            logger.info(f"Background task: Loading file from {job.file_path}")
            if job.file_path.startswith('s3://'):
                s3_service = get_s3_service()
                s3_key = job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                logger.info(f"Background task: Downloading from S3 key: {s3_key}")
                df = s3_service.download_file_as_dataframe(s3_key)
                if df is None:
                    raise FileNotFoundError(f"Failed to download file from S3: {job.file_path}")
                logger.info(f"Background task: Successfully loaded {len(df)} rows from S3")
            elif os.path.exists(job.file_path):
                logger.info(f"Background task: Loading local file: {job.file_path}")
                df = pd.read_csv(job.file_path, dtype=str, keep_default_na=False)
                logger.info(f"Background task: Successfully loaded {len(df)} rows from local file")
            else:
                raise FileNotFoundError(f"Original file for API job not found at path: {job.file_path}")
            
            # Apply column mapping if it exists and is meaningful
            # For API imports with no explicit mapping, preserve original column names and order
            if job.column_mapping and any(key != value for key, value in job.column_mapping.items() if value):
                logger.info(f"Background task: Applying column mapping: {job.column_mapping}")
                df = df.rename(columns=job.column_mapping)
            else:
                logger.info(f"Background task: No meaningful column mapping found. Preserving original CSV column order: {list(df.columns)}")
                
                # Check if headers match when no mapping is provided
                if not job.column_mapping:
                    logger.info(f"Background task: Checking header compatibility for job {job.id}")
                    # Get the importer configuration
                    importer = db.query(Importer).filter(Importer.id == job.importer_id).first()
                    if importer:
                        # Get the set of required field names from the importer
                        required_fields = {field['name'] for field in importer.fields if field.get('required', False)}
                        importer_field_names = {field['name'] for field in importer.fields}
                        
                        # Get CSV headers
                        csv_headers = set(df.columns.tolist())
                        
                        logger.info(f"Background task: Required fields: {required_fields}, CSV headers: {csv_headers}")
                        
                        # Check if all required fields are present in the CSV
                        missing_required_fields = required_fields - csv_headers
                        
                        # Check if CSV headers match importer field names (at least partially)
                        # If there's no overlap or major mismatch, fail the job
                        field_overlap = importer_field_names.intersection(csv_headers)
                        
                        # If less than 50% of importer fields are in the CSV, or required fields are missing
                        if len(missing_required_fields) > 0 or (len(field_overlap) < len(importer_field_names) * 0.5):
                            error_msg = "CSV headers do not match the expected importer field names. Please provide a column mapping or ensure your CSV headers match the importer configuration."
                            logger.error(f"Background task: Header mismatch for job {job.id}. {error_msg}")
                            logger.error(f"Background task: Missing required fields: {missing_required_fields}")
                            logger.error(f"Background task: Field overlap: {len(field_overlap)}/{len(importer_field_names)}")
                            
                            # Mark job as FAILED with clear error message
                            job.status = ImportStatus.FAILED
                            job.error_message = error_msg
                            
                            # Add specific missing field errors
                            job.errors = []
                            for field_name in missing_required_fields:
                                job.errors.append({
                                    "row": "Header",
                                    "column": field_name,
                                    "message": f"Required field '{field_name}' is missing from the CSV file."
                                })
                            
                            # Set error count
                            job.error_count = len(job.errors)
                            job.processed_rows = 0
                            
                            db.commit()
                            logger.error(f"Background task: Job {job.id} marked as FAILED due to header mismatch")
                            return  # Exit early since we can't process this file
            
            # Convert to list of dictionaries (same format as portal-created jobs)
            records = df.to_dict('records')
            
            logger.info(f"Background task: Successfully loaded {len(records)} records for job {import_job_id}.")
            
        except Exception as e:
            logger.error(f"Background task: Failed to load data for job {import_job_id}: {str(e)}", exc_info=True)
            job.status = ImportStatus.FAILED
            job.error_message = f"Failed to load data for editing: {str(e)}"
            db.commit()
            return
        
        # Step 2: Apply the pending cell edit to the loaded data (if provided)
        if pending_row_index is not None and pending_column_key is not None and pending_new_value is not None:
            try:
                logger.info(f"Background task: Applying pending edit - row={pending_row_index}, column={pending_column_key}, value='{pending_new_value}'")
                # Validate the pending edit
                if pending_row_index < 0 or pending_row_index >= len(records):
                    raise ValueError(f"Invalid row index: {pending_row_index}")
                    
                record = records[pending_row_index]
                if not isinstance(record, dict):
                    raise ValueError("Invalid data structure")
                    
                if pending_column_key not in record:
                    raise ValueError(f"Column '{pending_column_key}' not found in record")
                
                # Apply the edit
                old_value = record[pending_column_key]
                record[pending_column_key] = pending_new_value
                
                logger.info(f"Background task: Successfully applied pending edit - row={pending_row_index}, column_key={pending_column_key}, old='{old_value}', new='{pending_new_value}'")
                
            except Exception as e:
                logger.error(f"Background task: Failed to apply pending edit for job {import_job_id}: {str(e)}", exc_info=True)
                job.status = ImportStatus.FAILED
                job.error_message = f"Failed to apply pending edit: {str(e)}"
                db.commit()
                return
        
        # Step 3: Store in processed_data with the COMPLETE expected structure
        logger.info(f"Background task: Storing processed_data for job {import_job_id}")
        job.processed_data = {
            'data': records
        }
        
        # Add pending edit info if there was one
        if pending_row_index is not None and pending_column_key is not None and pending_new_value is not None:
            job.processed_data['first_edit'] = {
                'row': pending_row_index,
                'column_key': pending_column_key,
                'new_value': pending_new_value
            }
        
        # Step 4: Set appropriate status - preserve COMPLETED if it was already completed
        if job.status == ImportStatus.COMPLETED:
            # Keep the COMPLETED status if the job was already successfully completed
            logger.info(f"Background task: Preserving COMPLETED status for job {import_job_id}")
        else:
            # For other statuses, set to UNCOMPLETED (ready for editing)
            job.status = ImportStatus.UNCOMPLETED
            logger.info(f"Background task: Setting status to UNCOMPLETED for job {import_job_id}")
        
        # Use flag_modified to ensure SQLAlchemy detects the JSONB change
        flag_modified(job, 'processed_data')
        
        db.commit()
        logger.info(f"Background task: Successfully completed promotion for job {import_job_id}. Status: {job.status}, Records: {len(records)}")

    except Exception as e:
        logger.error(f"Background task: Critical error during promotion of job {import_job_id}: {str(e)}", exc_info=True)
        try:
            if job:
                job.status = ImportStatus.FAILED
                job.error_message = f"Critical error during promotion: {str(e)}"
                db.commit()
                logger.error(f"Background task: Job {import_job_id} marked as FAILED due to critical error")
        except Exception as commit_error:
            logger.error(f"Background task: Failed to update job status after error: {str(commit_error)}")
    finally:
        try:
            db.close()
            logger.info(f"Background task: Database connection closed for job {import_job_id}")
        except Exception as close_error:
            logger.error(f"Background task: Error closing database connection: {str(close_error)}")


async def promote_api_job_for_editing_async(import_job_id: uuid.UUID):
    """
    Async version of promote_api_job_for_editing that actually works in Docker.
    Runs the promotion in a thread pool to avoid blocking the event loop.
    """
    import asyncio
    import threading
    
    logger.error(f"🔥🔥🔥 ASYNC PROMOTION TASK STARTING for job {import_job_id}")
    
    def run_promotion():
        try:
            promote_api_job_for_editing(import_job_id)
            logger.error(f"✅ ASYNC PROMOTION COMPLETED successfully for job {import_job_id}")
        except Exception as e:
            logger.error(f"❌ ASYNC PROMOTION FAILED for job {import_job_id}: {str(e)}", exc_info=True)
    
    # Run in a thread pool to avoid blocking the event loop
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, run_promotion)


def test_background_task(import_job_id: uuid.UUID):
    """Simple test function to verify background tasks are working."""
    logger.info(f"TEST: Background task executed successfully for job {import_job_id}")


@router.get("/{import_job_id}/data")
async def get_import_data(
    import_job_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Universal import data viewer. If an API job is accessed for the first time,
    it triggers a background task to "promote" it for editing and returns a
    "promoting" status.
    """
    job = db.query(ImportJob).filter(ImportJob.id == import_job_id, ImportJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found.")

    # Handle FAILED jobs first
    if job.status == ImportStatus.FAILED:
        return {
            "status": "error",
            "error": job.error_message or "Import failed.",
            "headers": [],
            "data": [],
            "total_rows": 0,
            "conflicts": [],
            "import_info": {
                "file_name": job.file_name,
                "status": str(job.status.value),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "row_count": job.row_count or 0,
                "error_count": job.error_count or 0,
                "editable": False
            }
        }

    # Handle transient states first
    if job.status in [ImportStatus.PENDING, ImportStatus.PROCESSING]:
        return { 
            "status": "processing", 
            "message": "Import is still being processed.",
            "headers": [],
            "data": [],
            "total_rows": 0,
            "conflicts": [],
            "import_info": {
                "file_name": job.file_name,
                "status": str(job.status.value),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "row_count": job.row_count or 0,
                "editable": False
            }
        }
    
    # Check for header warning message
    header_warning = None
    if job.column_mapping and "_header_warning" in job.column_mapping:
        header_warning = job.column_mapping["_header_warning"]
        # If there's a header warning, return an error response instead of showing data
        return {
            "status": "error",
            "error": header_warning,
            "headers": [],
            "data": [],
            "total_rows": 0,
            "conflicts": [],
            "import_info": {
                "file_name": job.file_name,
                "status": str(job.status.value),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "row_count": job.row_count or 0,
                "error_count": job.error_count or 0,
                "editable": False
            }
        }
        
    if job.status == ImportStatus.PROMOTING:
        # Instead of returning empty data, let's load the data directly from S3
        # while the promotion happens in the background
        try:
            if job.file_path and job.file_path.startswith('s3://'):
                # Get S3 service and load data
                s3_service = get_s3_service()
                s3_key = job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                df = s3_service.download_file_as_dataframe(s3_key)
                
                if df is not None:
                    # Apply column mapping if exists
                    if job.column_mapping:
                        df = df.rename(columns=job.column_mapping)
                    
                    # Convert to the format expected by frontend
                    data = df.to_dict(orient='records')
                    
                    # Use original CSV header order
                    original_csv_headers = job.file_metadata.get('headers', []) if job.file_metadata else []
                    column_mapping = job.column_mapping or {}
                    
                    # SIMPLIFIED: Always use original CSV headers in exact order
                    if original_csv_headers:
                        headers = original_csv_headers.copy()
                    else:
                        headers = list(df.columns) if not df.empty else []
                    
                    # Create data rows for grid display
                    data_rows = [[str(row.get(h, "") or "") for h in headers] for row in data]
                    
                    # Get conflicts from job errors if any
                    conflicts = []
                    if job.errors:
                        # Create a mapping from importer field names to CSV column names for conflict resolution
                        field_to_csv_mapping = {}
                        if column_mapping:
                            for importer_field, csv_column in column_mapping.items():
                                field_to_csv_mapping[importer_field] = csv_column
                        
                        for error in job.errors:
                            if isinstance(error, dict):
                                error_message = error.get('message', str(error))
                                field_name = error.get('field') or error.get('column')
                                
                                if not field_name:
                                    continue
                                
                                display_column_name = field_to_csv_mapping.get(field_name, field_name)
                                col_index = headers.index(display_column_name) if display_column_name in headers else -1
                                
                                if col_index >= 0:
                                    row_number = error.get('row')
                                    if row_number == "Header":
                                        conflicts.append({
                                            "row": 0,
                                            "col": col_index,
                                            "error": error_message,
                                            "type": "structural"
                                        })
                                    else:
                                        grid_row_index = max(0, int(row_number) - 1) if isinstance(row_number, (int, str)) and str(row_number).isdigit() else 0
                                        conflicts.append({
                                            "row": grid_row_index,
                                            "col": col_index,
                                            "error": error_message,
                                            "type": "validation"
                                        })
                    
                    return {
                        "status": "promoting",
                        "message": "This large file is being prepared for editing. The view will refresh automatically.",
                        "headers": headers,
                        "data": data_rows,
                        "total_rows": len(data_rows),
                        "conflicts": conflicts,
                        "import_info": {
                            "file_name": job.file_name,
                            "status": str(job.status.value),
                            "created_at": job.created_at.isoformat() if job.created_at else None,
                            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                            "row_count": job.row_count or len(data),
                            "error_count": job.error_count or 0,
                            "editable": True
                        }
                    }
            
            # Fallback to minimal response if S3 loading fails
            response_data = {
                "status": "promoting",
                "message": "This large file is being prepared for editing. The view will refresh automatically.",
                "headers": [],
                "data": [],
                "total_rows": 0,
                "conflicts": [],
                "import_info": {
                    "file_name": job.file_name,
                    "status": str(job.status.value),
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "row_count": job.row_count or 0,
                    "editable": False
                }
            }
            if header_warning:
                response_data["header_warning"] = header_warning
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content=response_data
            )
            
        except Exception as e:
            logger.error(f"Error loading data while promoting job {job.id}: {e}")
            # Fallback to minimal response on error
            response_data = {
                "status": "promoting",
                "message": "This large file is being prepared for editing. The view will refresh automatically.",
                "headers": [],
                "data": [],
                "total_rows": 0,
                "conflicts": [],
                "import_info": {
                    "file_name": job.file_name,
                    "status": str(job.status.value),
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                    "row_count": job.row_count or 0,
                    "editable": False
                }
            }
            if header_warning:
                response_data["header_warning"] = header_warning
            return JSONResponse(
                status_code=status.HTTP_202_ACCEPTED,
                content=response_data
            )

    # --- THE "GATEKEEPER" LOGIC ---

    # Case 1: Job is already promoted/portal-native. Serve the data from the database.
    if job.processed_data:
        logger.info(f"Loading data for database-managed job {import_job_id} from processed_data field.")
        data = job.processed_data.get("data", [])
        
        importer = db.query(Importer).filter(Importer.id == job.importer_id).first()
        
        if data:
            # --- THIS IS THE FIX ---
            # Prioritize the original CSV header order stored in metadata
            original_csv_headers = job.file_metadata.get('headers', []) if job.file_metadata else []
            column_mapping = job.column_mapping or {}
            
            available_fields = set(data[0].keys()) if data else set()

            # Debug logging to understand what's happening
            logger.info(f"DEBUG: file_metadata = {job.file_metadata}")
            logger.info(f"DEBUG: original_csv_headers = {original_csv_headers}")
            logger.info(f"DEBUG: column_mapping = {column_mapping}")
            logger.info(f"DEBUG: available_fields = {available_fields}")

            # SIMPLIFIED: Always use original CSV headers in exact order - no complex mapping
            if original_csv_headers:
                logger.info("Using original CSV headers in exact order (simplified approach).")
                headers = original_csv_headers.copy()  # Use exact CSV header order, always
                logger.info(f"DEBUG: Final headers order = {headers}")
            else:
                # Fallback: Use available field names in any order
                logger.info("No original CSV headers available - using available field names.")
                headers = list(available_fields) if available_fields else []
                logger.info(f"DEBUG: Fallback headers = {headers}")
            
            data_rows = [[row.get(h, "") for h in headers] for row in data]
        else:
            headers = []
            data_rows = []

        # Format conflicts for the frontend data grid
        conflicts = []
        # logger.info(f"DEBUG CONFLICTS: job.errors = {job.errors}")
        # logger.info(f"DEBUG CONFLICTS: type(job.errors) = {type(job.errors)}")
        if job.errors and isinstance(job.errors, list):
            # logger.info(f"DEBUG CONFLICTS: Processing {len(job.errors)} errors")
            
            # Create a mapping from importer field names to CSV column names for conflict resolution
            field_to_csv_mapping = {}
            if column_mapping:
                # column_mapping format: {importer_field: csv_column}
                for importer_field, csv_column in column_mapping.items():
                    field_to_csv_mapping[importer_field] = csv_column
            
            for error in job.errors:
                if isinstance(error, dict) and 'row' in error:
                    # Handle both API ('column'/'message') and portal ('field'/'error') formats
                    field_name = error.get('field') or error.get('column')
                    error_message = error.get('error') or error.get('message', 'Unknown error')
                    
                    if not field_name:
                        continue
                    
                    # FIXED: Map importer field name to CSV column name for conflict display
                    display_column_name = field_to_csv_mapping.get(field_name, field_name)
                    col_index = headers.index(display_column_name) if display_column_name in headers else -1
                    
                    # logger.info(f"DEBUG CONFLICTS: field_name='{field_name}' -> display_column_name='{display_column_name}' -> col_index={col_index}")
                    
                    if col_index >= 0:
                        row_number = error.get('row')
                        # Handle special case of "Header" errors from API imports
                        if row_number == "Header":
                            # For structural errors, show on first row but mark as structural
                            conflicts.append({
                                "row": 0,  # Show on first data row
                                "col": col_index,
                                "error": error_message,
                                "type": "structural"
                            })
                        else:
                            # Regular validation errors
                            # Convert to 0-based index consistently
                            if isinstance(row_number, (int, str)) and str(row_number).isdigit():
                                # Convert 1-based row number to 0-based array index
                                grid_row_index = int(row_number) - 1
                                # Ensure we don't get negative indices
                                grid_row_index = max(0, grid_row_index)
                            else:
                                grid_row_index = 0
                                
                            conflicts.append({
                                "row": grid_row_index,
                                "col": col_index,
                                "error": error_message,
                                "type": "validation"
                            })
        
        return {
            "headers": headers,
            "data": data_rows,
            "total_rows": len(data_rows),
            "conflicts": conflicts,
            "import_info": {
                "file_name": job.file_name,
                "status": str(job.status.value),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "row_count": job.row_count or 0,
                "error_count": job.error_count or 0,
                "editable": True 
            },
            "header_warning": header_warning
        }

    # Case 2: Job has S3 file path - API imports should be fully processed by now
    elif job.file_path and job.file_path.startswith('s3://'):
        # For API imports, data should have been processed during background job
        # If no processed_data exists, the job should be FAILED or still PROCESSING
        if job.status in [ImportStatus.PENDING, ImportStatus.PROCESSING, ImportStatus.VALIDATING]:
            return { 
                "status": "processing", 
                "message": "Import is still being processed.",
                "headers": [],
                "data": [],
                "total_rows": 0,
                "conflicts": [],
                "import_info": {
                    "file_name": job.file_name,
                    "status": str(job.status.value),
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                    "row_count": job.row_count or 0,
                    "editable": False
                }
            }
        
        # For COMPLETED/UNCOMPLETED jobs, load and show the data from S3 directly
        try:
            # Get S3 service and load data
            s3_service = get_s3_service()
            s3_key = job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
            df = s3_service.download_file_as_dataframe(s3_key)
            
            if df is not None:
                # Apply column mapping if exists
                if job.column_mapping:
                    df = df.rename(columns=job.column_mapping)
                
                # Convert to the format expected by frontend
                data = df.to_dict(orient='records')
                
                # Use original CSV header order
                original_csv_headers = job.file_metadata.get('headers', []) if job.file_metadata else []
                
                # SIMPLIFIED: Always use original CSV headers in exact order
                if original_csv_headers:
                    headers = original_csv_headers.copy()
                else:
                    headers = list(df.columns) if not df.empty else []
                
                # Create data rows for grid display
                data_rows = [[str(row.get(h, "") or "") for h in headers] for row in data]
                
                # Get conflicts from job errors if any
                conflicts = []
                if job.errors:
                    # Create a mapping from importer field names to CSV column names for conflict resolution
                    field_to_csv_mapping = {}
                    if job.column_mapping:
                        for importer_field, csv_column in job.column_mapping.items():
                            field_to_csv_mapping[importer_field] = csv_column
                    
                    for error in job.errors:
                        if isinstance(error, dict):
                            error_message = error.get('message', str(error))
                            field_name = error.get('field') or error.get('column')
                            
                            if not field_name:
                                continue
                            
                            display_column_name = field_to_csv_mapping.get(field_name, field_name)
                            col_index = headers.index(display_column_name) if display_column_name in headers else -1
                            
                            if col_index >= 0:
                                row_number = error.get('row')
                                if row_number == "Header":
                                    conflicts.append({
                                        "row": 0,
                                        "col": col_index,
                                        "error": error_message,
                                        "type": "structural"
                                    })
                                else:
                                    grid_row_index = max(0, int(row_number) - 1) if isinstance(row_number, (int, str)) and str(row_number).isdigit() else 0
                                    conflicts.append({
                                        "row": grid_row_index,
                                        "col": col_index,
                                        "error": error_message,
                                        "type": "validation"
                                    })
                
                return {
                    "headers": headers,
                    "data": data_rows,
                    "total_rows": len(data_rows),
                    "conflicts": conflicts,
                    "import_info": {
                        "file_name": job.file_name,
                        "status": str(job.status.value),
                        "created_at": job.created_at.isoformat() if job.created_at else None,
                        "row_count": job.row_count or len(data),
                        "error_count": job.error_count or 0,
                        "editable": True
                    }
                }
        
        except Exception as e:
            logger.error(f"Error loading data from S3 job {job.id}: {e}")
            raise HTTPException(status_code=500, detail=f"Error loading import data: {str(e)}")

    # Case 3: Legacy local file path - promote to database (OLD BEHAVIOR)  
    elif job.file_path:
        # Set status to PROMOTING to act as a lock and prevent duplicate jobs
        job.status = ImportStatus.PROMOTING
        db.commit()
        
        # Schedule the background task to do the heavy lifting
        background_tasks.add_task(promote_api_job_to_portal_managed, job.id)
        logger.info(f"Scheduled promotion task for API job {job.id}")

        # Load and show the data immediately while promotion happens in background
        try:
            if os.path.exists(job.file_path):
                df = pd.read_csv(job.file_path, dtype=str, keep_default_na=False, na_filter=False).fillna("")
                if df is not None:
                    # Apply column mapping if exists
                    if job.column_mapping:
                        df = df.rename(columns=job.column_mapping)
                    
                    # Convert to the format expected by frontend
                    data = df.to_dict(orient='records')
                    
                    # Use original CSV header order
                    original_csv_headers = job.file_metadata.get('headers', []) if job.file_metadata else []
                    column_mapping = job.column_mapping or {}
                    
                    # SIMPLIFIED: Always use original CSV headers in exact order
                    if original_csv_headers:
                        headers = original_csv_headers.copy()
                    else:
                        headers = list(df.columns) if not df.empty else []
                    
                    # Create data rows for grid display
                    data_rows = [[str(row.get(h, "") or "") for h in headers] for row in data]
                    
                    # Get conflicts from job errors if any
                    conflicts = []
                    if job.errors:
                        # Create a mapping from importer field names to CSV column names for conflict resolution
                        field_to_csv_mapping = {}
                        if column_mapping:
                            for importer_field, csv_column in column_mapping.items():
                                field_to_csv_mapping[importer_field] = csv_column
                        
                        for error in job.errors:
                            if isinstance(error, dict):
                                error_message = error.get('message', str(error))
                                field_name = error.get('field') or error.get('column')
                                
                                if not field_name:
                                    continue
                                
                                display_column_name = field_to_csv_mapping.get(field_name, field_name)
                                col_index = headers.index(display_column_name) if display_column_name in headers else -1
                                
                                if col_index >= 0:
                                    row_number = error.get('row')
                                    if row_number == "Header":
                                        conflicts.append({
                                            "row": 0,
                                            "col": col_index,
                                            "error": error_message,
                                            "type": "structural"
                                        })
                                    else:
                                        grid_row_index = max(0, int(row_number) - 1) if isinstance(row_number, (int, str)) and str(row_number).isdigit() else 0
                                        conflicts.append({
                                            "row": grid_row_index,
                                            "col": col_index,
                                            "error": error_message,
                                            "type": "validation"
                                        })
                    
                    return {
                        "status": "promoting",
                        "message": "This large file is being prepared for editing. The view will refresh automatically.",
                        "headers": headers,
                        "data": data_rows,
                        "total_rows": len(data_rows),
                        "conflicts": conflicts,
                        "import_info": {
                            "file_name": job.file_name,
                            "status": str(ImportStatus.PROMOTING.value),
                            "created_at": job.created_at.isoformat() if job.created_at else None,
                            "row_count": job.row_count or len(data),
                            "editable": True
                        }
                    }
        
        except Exception as e:
            logger.error(f"Error loading data while promoting legacy job {job.id}: {e}")
        
        # Fallback to minimal response if file loading fails
        return {
            "status": "promoting",
            "message": "This large file is being prepared for editing. The view will refresh automatically.",
            "headers": [],
            "data": [],
            "total_rows": 0,
            "conflicts": [],
            "import_info": {
                "file_name": job.file_name,
                "status": str(ImportStatus.PROMOTING.value),
                "created_at": job.created_at.isoformat() if job.created_at else None,
                "updated_at": job.updated_at.isoformat() if job.updated_at else None,
                "row_count": job.row_count or 0,
                "editable": False
            }
        }

    # Fallback for a completed job with no data source
    else:
        logger.warning(f"Job {import_job_id} is complete but has no data source.")
        raise HTTPException(status_code=404, detail="No data source found for this import job.")

class UpdateCellRequest(BaseModel):
    row_index: int
    column_key: str
    new_value: str


class UpdateDataRequest(BaseModel):
    data: List[List[Any]]  # Data comes in as a list of lists from the frontend table
    headers: Optional[List[str]] = None  # Optional headers to preserve column keys


class SaveDataRequest(BaseModel):
    data: List[List[str]]


class AIProcessRequest(BaseModel):
    prompt: str
    

class AIProcessResponse(BaseModel):
    success: bool
    operation: Optional[Dict[str, Any]] = None
    transformations: Optional[List[Dict[str, Any]]] = None  # This field is crucial
    chat_message: Optional[str] = None  # For non-transformation chat responses
    error: Optional[str] = None


@router.patch("/{import_job_id}/cell")
async def update_cell(
    import_job_id: uuid.UUID,
    request: UpdateCellRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update a single cell in the import data using the asynchronous "promotion" pattern.
    
    For API-created jobs (with file_path), the first edit triggers an asynchronous promotion:
    1. Set job status to PROMOTING (acts as a lock)
    2. Schedule background task to load data from S3 into processed_data
    3. Return 202 Accepted immediately to prevent timeouts
    4. Frontend polls for completion
    
    For portal-created jobs (with processed_data), edits are applied directly to the database.
    
    Parameters:
        import_job_id: UUID of the import job
        request: UpdateCellRequest with row_index, column_key, new_value
        background_tasks: FastAPI background task manager
        db: Database session
        current_user: Authenticated user making the request
        
    Returns:
        Success message or 202 Accepted for promotion
        
    Raises:
        HTTPException: If the job is not found, indices are invalid, or an error occurs
    """
    try:
        import json
        
        # Get the import job
        import_job = import_service.get_import_job(
            db, str(current_user.id), import_job_id
        )
        if not import_job:
            raise HTTPException(status_code=404, detail="Import job not found")
        
        # THE ASYNCHRONOUS PROMOTION PATTERN: Check if this is an API job that needs promotion
        if not import_job.processed_data and import_job.file_path:
            logger.info(f"Edit request for API job {import_job_id} that hasn't been promoted yet.")
            
            # Check if promotion is already in progress
            if import_job.status == ImportStatus.PROMOTING:
                # Promotion is in progress, tell the user to wait
                logger.info(f"Promotion already in progress for job {import_job_id}. Returning 425 status.")
                raise HTTPException(
                    status_code=425,  # "Too Early" status code
                    detail="File is still being prepared for editing. Please try again in a moment."
                )
            
            # Start promotion process and wait briefly for it to complete
            logger.info(f"Starting asynchronous promotion for API job {import_job_id}.")
            
            # Step 1: Set status to PROMOTING to act as a lock and prevent duplicate promotions
            import_job.status = ImportStatus.PROMOTING
            db.commit()
            
            # Step 2: Start promotion asynchronously using asyncio (fire and forget)
            import asyncio
            asyncio.create_task(promote_api_job_for_editing_async(import_job_id))
            
            logger.info(f"Scheduled asynchronous promotion task for API job {import_job_id}")
            
            # Step 3: Wait a short time for promotion to complete (up to 3 seconds)
            for i in range(30):  # 30 * 0.1s = 3 seconds max
                await asyncio.sleep(0.1)
                
                # Refresh job status from database
                db.refresh(import_job)
                
                if import_job.processed_data and import_job.status != ImportStatus.PROMOTING:
                    # Promotion completed! Continue with the edit
                    logger.info(f"Promotion completed for job {import_job_id}, proceeding with edit")
                    break
            else:
                # Promotion didn't complete in time, return 425
                logger.info(f"Promotion still in progress after 3 seconds for job {import_job_id}. Returning 425 status.")
                raise HTTPException(
                    status_code=425,  # "Too Early" status code
                    detail="File is being prepared for editing. Please try again in a moment."
                )
        
        # For already-promoted jobs, apply the edit directly (fast path)
        # Check if processed data exists
        if not import_job.processed_data:
            raise HTTPException(status_code=400, detail="No processed data available for editing.")

        data = import_job.processed_data.get("data", [])

        # Validate indices
        if not (0 <= request.row_index < len(data)):
            raise HTTPException(status_code=400, detail="Invalid row index")

        record = data[request.row_index]
        if request.column_key not in record:
            raise HTTPException(status_code=400, detail=f"Column '{request.column_key}' not found in record")

        # Update the value directly using the key
        old_value = record[request.column_key]
        record[request.column_key] = request.new_value
        
        logger.info(f"Cell update: row={request.row_index}, column_key={request.column_key}, old='{old_value}', new='{request.new_value}'")

        # --- OPTIMIZED REAL-TIME VALIDATION ---
        # Perform instant single-cell validation without full dataset revalidation
        new_conflict = None
        resolved = False
        cell_validation_result = None
        
        try:
            importer = db.query(Importer).filter(Importer.id == import_job.importer_id).first()
            if not importer:
                raise ValueError("Importer configuration not found")
            
            # Use column mapping to translate CSV column name to importer field name
            field_name = request.column_key  # Default to column key
            if import_job.column_mapping:
                # column_mapping format: {importer_field: csv_column}
                # We need to find which importer field maps to this CSV column
                for importer_field, csv_column in import_job.column_mapping.items():
                    if csv_column == request.column_key:
                        field_name = importer_field
                        break
            
            field_config = next((f for f in importer.fields if f.get('name') == field_name), None)
            
            if field_config:
                logger.info(f"Validating field '{field_name}' with value '{request.new_value}'")
                
                # Use the validation service for immediate feedback
                error_message = validation_service.validate_field(request.new_value, field_config)
                
                cell_validation_result = {
                    "field": field_name,
                    "column_key": request.column_key,
                    "row_index": request.row_index,
                    "value": request.new_value,
                    "error": error_message,
                    "valid": error_message is None
                }
                
                if error_message:
                    # The new value has a validation error
                    new_conflict = {
                        "row": request.row_index,
                        "col": request.column_key,
                        "field": field_name,
                        "csvColumn": request.column_key,
                        "error": error_message,
                        "value": request.new_value
                    }
                    logger.info(f"Validation failed for {field_name}: {error_message}")
                else:
                    # The value is valid - conflict was resolved
                    resolved = True
                    logger.info(f"Validation passed for {field_name}")
            else:
                logger.warning(f"No field configuration found for '{field_name}' (column: {request.column_key})")
                
        except Exception as validation_error:
            logger.error(f"Error during cell validation: {str(validation_error)}")
            # Don't fail the entire request for validation errors

        # 2. Update the main `errors` list on the job
        original_errors = import_job.errors or []
        # Remove any old errors for this specific cell
        updated_errors = [
            e for e in original_errors 
            if not (e.get('row') == request.row_index + 1 and (e.get('field') or e.get('column')) == field_name)
        ]
        # Add the new error if one was found
        if new_conflict:
            updated_errors.append({
                "row": request.row_index + 1,
                "field": field_name,  # Use the actual field name
                "value": request.new_value,
                "error": new_conflict["error"]
            })
        
        import_job.errors = updated_errors
        import_job.error_count = len(updated_errors)

        # 2.5. Update job status based on error count
        if len(updated_errors) == 0:
            # No conflicts remaining - mark as completed
            import_job.status = ImportStatus.COMPLETED
            logger.info(f"Job {import_job_id} marked as COMPLETED - all conflicts resolved")
        else:
            # Conflicts exist - mark as uncompleted for editing
            import_job.status = ImportStatus.UNCOMPLETED
            logger.info(f"Job {import_job_id} marked as UNCOMPLETED - {len(updated_errors)} conflicts remaining")

        # 3. Update the processed_data structure with the modified data
        updated_processed_data = import_job.processed_data.copy()
        updated_processed_data['data'] = data
        updated_processed_data['last_edited'] = datetime.now().isoformat()

        # Completely reassign the processed_data to ensure SQLAlchemy detects the change
        import_job.processed_data = updated_processed_data
        flag_modified(import_job, 'processed_data')
        
        # Explicitly update the updated_at timestamp to ensure it's refreshed
        import_job.updated_at = datetime.now()

        logger.info(f"Updated processed_data structure successfully for import job {import_job_id}")
        
        # 4. Save everything back to the database
        db.commit()
        db.refresh(import_job)
        
        # 5. Return optimized response with instant cell validation feedback
        response_data = {
            "success": True,
            "message": "Cell updated successfully.",
            "updated_value": request.new_value,
            "cell_position": {
                "row": request.row_index,
                "column_key": request.column_key,
                "field": field_name if 'field_name' in locals() else request.column_key
            },
            "validation_timestamp": datetime.now().isoformat(),
            "total_errors": len(updated_errors)
        }
        
        # Include instant cell validation result if available
        if cell_validation_result:
            response_data["cell_validation"] = cell_validation_result
        
        # Add conflict information to response
        if new_conflict:
            response_data["conflicts"] = [new_conflict]
            response_data["new_conflict"] = new_conflict
            response_data["resolved"] = False
        elif resolved:
            response_data["resolved_conflicts"] = [{
                "row": request.row_index,
                "col": request.column_key,
                "field": field_name if 'field_name' in locals() else request.column_key
            }]
            response_data["resolved"] = True
        else:
            response_data["resolved"] = False
            
        return response_data
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating cell in import job {import_job_id}: {str(e)}")
        db.rollback()
        raise HTTPException(
            status_code=500, detail=f"Error updating cell: {str(e)}"
        )




async def optimized_save_and_validate(
    db: Session,
    import_job: ImportJob, 
    new_data: List[List[Any]], 
    headers: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    OPTIMIZED save and validation that only validates changed cells.
    This replaces the slow full-dataset revalidation with intelligent diff-based validation.
    
    Performance improvements:
    1. Only validate cells that actually changed
    2. Preserve existing validation state for unchanged cells
    3. Process changes in memory without background tasks
    4. Return immediate results
    
    Args:
        db: Database session
        import_job: The import job object
        new_data: New data from frontend
        headers: Column headers
        
    Returns:
        Dict with validation results and timing information
    """
    import time
    start_time = time.time()
    
    try:
        # Get the current processed data
        existing_data = import_job.processed_data.get('data', []) if import_job.processed_data else []
        
        # Get importer configuration
        importer = db.query(Importer).filter(Importer.id == import_job.importer_id).first()
        if not importer:
            raise ValueError("Importer configuration not found")
        
        # Determine column headers
        all_column_headers = headers or []
        if not all_column_headers and existing_data:
            all_column_headers = list(existing_data[0].keys()) if existing_data else []
        
        # Create field mapping for validation
        column_mapping = import_job.column_mapping or {}
        csv_column_to_field = {}
        field_configs_by_name = {f['name']: f for f in importer.fields}
        
        if column_mapping:
            for field_name, csv_column in column_mapping.items():
                if csv_column and not field_name.startswith('_'):
                    csv_column_to_field[csv_column] = field_name
        
        # OPTIMIZATION: Find only changed cells
        changed_cells = []
        validated_cells = 0
        
        for row_idx, new_row in enumerate(new_data):
            if row_idx >= len(existing_data):
                # New row - validate all mapped cells
                for col_idx, cell_value in enumerate(new_row):
                    if col_idx < len(all_column_headers):
                        column_header = all_column_headers[col_idx]
                        if column_header in csv_column_to_field:
                            changed_cells.append((row_idx, col_idx, column_header, cell_value))
            else:
                # Existing row - only validate changed cells
                existing_row = existing_data[row_idx]
                for col_idx, cell_value in enumerate(new_row):
                    if col_idx < len(all_column_headers):
                        column_header = all_column_headers[col_idx]
                        if column_header in csv_column_to_field:
                            existing_value = existing_row.get(column_header, '')
                            if str(cell_value) != str(existing_value):
                                changed_cells.append((row_idx, col_idx, column_header, cell_value))
        
        logger.info(f"OPTIMIZATION: Found {len(changed_cells)} changed cells to validate (vs {len(new_data) * len(csv_column_to_field)} in full validation)")
        
        # Validate only changed cells
        new_errors = []
        for row_idx, col_idx, column_header, cell_value in changed_cells:
            field_name = csv_column_to_field[column_header]
            field_config = field_configs_by_name.get(field_name)
            
            if field_config:
                validated_cells += 1
                error_message = validation_service.validate_field(cell_value, field_config)
                if error_message:
                    new_errors.append({
                        "row": row_idx + 1,
                        "field": field_name,
                        "column": column_header,
                        "value": cell_value,
                        "error": error_message,
                    })
        
        # Preserve existing errors for unchanged cells
        existing_errors = import_job.errors or []
        unchanged_errors = []
        
        # Keep errors for cells that weren't changed
        changed_positions = {(row_idx, csv_column_to_field.get(col_header, col_header)) 
                           for row_idx, _, col_header, _ in changed_cells}
        
        for error in existing_errors:
            error_pos = (error.get('row', 0) - 1, error.get('field', error.get('column', '')))
            if error_pos not in changed_positions:
                unchanged_errors.append(error)
        
        # Combine unchanged errors with new validation results
        all_errors = unchanged_errors + new_errors
        
        # Convert data to dict format
        updated_data_as_dicts = []
        for row_values in new_data:
            row_dict = {}
            for idx, column_header in enumerate(all_column_headers):
                row_dict[column_header] = row_values[idx] if idx < len(row_values) else ""
            updated_data_as_dicts.append(row_dict)
        
        # Update database with COMPLETE structure
        # Update database with simplified structure - only store data
        # Errors are stored separately in import_job.errors field
        if isinstance(import_job.processed_data, dict):
            import_job.processed_data['data'] = updated_data_as_dicts
        else:
            import_job.processed_data = {
                'data': updated_data_as_dicts
            }
        
        flag_modified(import_job, "processed_data")
        import_job.errors = all_errors
        import_job.error_count = len(all_errors)
        
        # Set status based on error count
        if len(all_errors) == 0:
            import_job.status = ImportStatus.COMPLETED
            logger.info(f"Job {import_job.id} marked as COMPLETED - no validation errors found")
        else:
            import_job.status = ImportStatus.UNCOMPLETED
            logger.info(f"Job {import_job.id} marked as UNCOMPLETED - {len(all_errors)} validation errors found")
        
        db.commit()
        
        processing_time = (time.time() - start_time) * 1000  # Convert to milliseconds
        
        logger.info(f"OPTIMIZED VALIDATION COMPLETE: {validated_cells} cells validated in {processing_time:.2f}ms")
        
        return {
            'validated_cells': validated_cells,
            'total_errors': len(all_errors),
            'new_errors': len(new_errors),
            'preserved_errors': len(unchanged_errors),
            'processing_time_ms': processing_time
        }
        
    except Exception as e:
        logger.error(f"Error in optimized validation: {str(e)}")
        raise


def revalidate_and_save_job(import_job_id: uuid.UUID, updated_data_rows: List[List[Any]], provided_headers: Optional[List[str]] = None):
    """
    LEGACY FUNCTION - A background job that performs the heavy lifting of re-validating and saving
    data from the portal's data editor.
    
    NOTE: This function is now primarily used for fallback cases. The new optimized approach
    uses optimized_save_and_validate() for much better performance.
    
    Args:
        import_job_id: UUID of the import job
        updated_data_rows: 2D array of cell values from the frontend (ALL columns)
        provided_headers: Optional list of column headers from the frontend to preserve column keys
    """
    db = SessionLocal()
    try:
        # 1. Fetch the job and importer config
        job = db.query(ImportJob).filter(ImportJob.id == import_job_id).first()
        if not job:
            logger.error(f"Revalidation worker: Job {import_job_id} not found.")
            return
        
        # RELIABLE DETECTION: Use import_source field
        is_api_import = job.import_source == ImportSource.API
        logger.info(f"\n=== SAVE DEBUG: job_id={import_job_id} ===")
        logger.info(f"Import source: {job.import_source}")
        logger.info(f"Total rows to validate: {len(updated_data_rows)}")

        importer = db.query(Importer).filter(Importer.id == job.importer_id).first()
        if not importer:
            job.status = ImportStatus.FAILED
            job.error_message = "Importer configuration not found during re-validation."
            db.commit()
            return
            
        # 2. SIMPLIFIED APPROACH: Determine column structure
        # Priority 1: Use existing processed_data structure if available (preserves edits)
        # Priority 2: Use file_metadata headers (original CSV structure)
        # Priority 3: Use provided headers from frontend
        
        all_column_headers = []  # ALL columns including unmapped
        column_mapping = job.column_mapping or {}  # field_name -> csv_column mapping
        
        # Try to get column headers from existing processed_data
        if job.processed_data and 'data' in job.processed_data:
            existing_data = job.processed_data.get('data', [])
            if existing_data and len(existing_data) > 0:
                first_record = existing_data[0]
                if isinstance(first_record, dict):
                    all_column_headers = list(first_record.keys())
                    logger.info(f"Using column headers from existing processed_data: {all_column_headers}")
        
        # Fall back to file_metadata headers
        if not all_column_headers and job.file_metadata:
            all_column_headers = job.file_metadata.get('headers', [])
            logger.info(f"Using column headers from file_metadata: {all_column_headers}")
        
        # Fall back to provided headers
        if not all_column_headers and provided_headers:
            all_column_headers = provided_headers
            logger.info(f"Using provided headers: {all_column_headers}")
        
        # If still no headers, try to infer from data length
        if not all_column_headers and updated_data_rows and len(updated_data_rows) > 0:
            num_cols = len(updated_data_rows[0])
            all_column_headers = [f"Column_{i}" for i in range(num_cols)]
            logger.warning(f"No headers found, using generic column names: {all_column_headers}")
        
        if not all_column_headers:
            logger.error(f"No column structure found for job {import_job_id}")
            job.status = ImportStatus.FAILED
            job.error_message = "No column structure found for revalidation."
            db.commit()
            return
        
        # 3. Build mappings for validation
        # Create a reverse mapping: csv_column -> field_name for validation
        csv_column_to_field = {}
        if column_mapping:
            # Filter out special keys
            filtered_mapping = {k: v for k, v in column_mapping.items() if not k.startswith('_')}
            for field_name, csv_column in filtered_mapping.items():
                if csv_column:  # Only map if there's actually a CSV column
                    csv_column_to_field[csv_column] = field_name
        
        logger.info(f"Columns that will be validated: {list(csv_column_to_field.keys())}")
        
        # Get field configurations for validation
        field_configs_by_name = {f['name']: f for f in importer.fields}
        
        # 4. Perform validation ONLY on mapped columns
        all_new_errors = []
        total_cells_validated = 0
        
        logger.info(f"Starting validation of {len(updated_data_rows)} rows x {len(csv_column_to_field)} mapped columns = {len(updated_data_rows) * len(csv_column_to_field)} potential validations")
        
        for row_idx, row_values in enumerate(updated_data_rows):
            # Ensure we have the right number of values
            if len(row_values) != len(all_column_headers):
                logger.warning(f"Row {row_idx} has {len(row_values)} values but expected {len(all_column_headers)}")
            
            # Validate each cell
            for col_idx, column_header in enumerate(all_column_headers):
                if col_idx >= len(row_values):
                    continue
                    
                cell_value = row_values[col_idx]
                
                # Only validate if this column is mapped to a field
                if column_header in csv_column_to_field:
                    field_name = csv_column_to_field[column_header]
                    field_config = field_configs_by_name.get(field_name)
                    
                    if field_config:
                        total_cells_validated += 1
                        
                        error_message = validation_service.validate_field(cell_value, field_config)
                        if error_message:
                            # Log date validation errors for debugging
                            if field_config.get('type') in ['date', 'datetime']:
                                logger.warning(f"DATE validation failed for '{field_name}': value='{cell_value}', error='{error_message}'")
                            
                            all_new_errors.append({
                                "row": row_idx + 1,
                                "field": field_name,  # Store field name for error
                                "column": column_header,  # Also store column for reference
                                "value": cell_value,
                                "error": error_message,
                            })
                # Unmapped columns are not validated, just preserved
        
        logger.info(f"VALIDATION COMPLETE: Validated {total_cells_validated} cells, found {len(all_new_errors)} errors")
        logger.info(f"=== END SAVE DEBUG ===")
        
        
        # 5. Reconstruct data as dicts preserving ALL columns
        updated_data_as_dicts = []
        for row_values in updated_data_rows:
            row_dict = {}
            # Process ALL columns, not just mapped ones
            for idx, column_header in enumerate(all_column_headers):
                if idx < len(row_values):
                    row_dict[column_header] = row_values[idx]
                else:
                    # If we have fewer values than headers, pad with empty strings
                    row_dict[column_header] = ""
            updated_data_as_dicts.append(row_dict)
        
        logger.info(f"Reconstructed {len(updated_data_as_dicts)} rows with {len(all_column_headers)} columns each")
        
        # Always store data in processed_data with simplified structure
        # Errors are stored separately in job.errors field
        if isinstance(job.processed_data, dict):
            job.processed_data['data'] = updated_data_as_dicts
        else:
            job.processed_data = {
                'data': updated_data_as_dicts
            }
        
        flag_modified(job, "processed_data")
        
        job.errors = all_new_errors
        job.error_count = len(all_new_errors)
        
        # IMPORTANT: Don't auto-complete API imports! 
        # Keep them in UNCOMPLETED status for user editing regardless of validation errors
        # The user should explicitly mark them as completed when ready
        job.status = ImportStatus.UNCOMPLETED
        
        db.commit()

    except Exception as e:
        logger.error(f"Error in revalidation worker for job {import_job_id}: {e}", exc_info=True)
        if 'job' in locals() and job:
            job.status = ImportStatus.FAILED
            job.error_message = "A critical error occurred while saving data."
            db.commit()
    finally:
        db.close()


@router.put("/{import_job_id}/data")
async def save_data(
    import_job_id: uuid.UUID,
    request: UpdateDataRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    OPTIMIZED save endpoint that provides instant validation feedback.
    
    NEW APPROACH:
    - Uses intelligent diff-based validation (only validates changed cells)
    - Returns immediately with validation results instead of background processing
    - Eliminates 20-second delay by preserving unchanged cell validation state
    - Maintains data integrity while dramatically improving performance
    """
    try:
        # 1. Fetch the job
        job = db.query(ImportJob).filter(
            ImportJob.id == import_job_id,
            ImportJob.user_id == current_user.id
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail="Import job not found")

        logger.info(f"Starting OPTIMIZED save for job {import_job_id} with {len(request.data)} rows")

        # 2. Use optimized validation that only processes changed cells
        validation_result = await optimized_save_and_validate(
            db=db,
            import_job=job,
            new_data=request.data,
            headers=getattr(request, 'headers', None)
        )

        # 3. Determine correct status based on validation results
        # Get the updated job status after validation
        db.refresh(job)  # Refresh to get the latest status set by optimized_save_and_validate
        final_status = str(job.status.value) if hasattr(job.status, 'value') else str(job.status)
        
        # 4. Return immediate response with validation results and correct status
        return {
            "success": True,
            "message": "Changes saved successfully!",
            "import_id": str(import_job_id),
            "status": final_status,  # Use the actual status from database
            "validation_summary": {
                "total_errors": validation_result['total_errors'],
                "new_errors": validation_result['new_errors'],
                "preserved_errors": validation_result['preserved_errors'],
                "validated_cells": validation_result['validated_cells'],
                "processing_time_ms": validation_result['processing_time_ms']
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in optimized save for job {import_job_id}: {str(e)}")
        
        # Fallback to background processing if optimized approach fails
        logger.info(f"Falling back to background validation for job {import_job_id}")
        
        job = db.query(ImportJob).filter(
            ImportJob.id == import_job_id,
            ImportJob.user_id == current_user.id
        ).first()
        
        if job:
            job.status = ImportStatus.SAVING
            db.commit()
            
            background_tasks.add_task(
                revalidate_and_save_job, 
                import_job_id, 
                request.data, 
                getattr(request, 'headers', None)
            )
        
        return {
            "success": True,
            "message": "Save operation queued for background processing due to optimization failure.",
            "import_id": str(import_job_id),
            "status": "SAVING",
            "fallback_used": True,
            "error": str(e)
        }


@router.get("/{import_job_id}/status")
async def get_import_job_status(
    import_job_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get the current status of an import job.
    
    This endpoint allows the frontend to poll for status updates,
    especially useful when background processing is in progress.
    """
    try:
        import_job = import_service.get_import_job(
            db, str(current_user.id), import_job_id
        )
        if not import_job:
            raise HTTPException(status_code=404, detail="Import job not found")
        
        return {
            "import_id": str(import_job.id),
            "status": import_job.status,
            "row_count": import_job.row_count,
            "processed_rows": import_job.processed_rows,
            "error_count": import_job.error_count,
            "created_at": import_job.created_at.isoformat() if import_job.created_at else None,
            "updated_at": import_job.updated_at.isoformat() if import_job.updated_at else None,
            "file_name": import_job.file_name,
            "has_processed_data": bool(import_job.processed_data),
            "error_message": import_job.error_message
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting status for import job {import_job_id}: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error getting import job status: {str(e)}"
        )


# --------------------------------



@router.post("/{import_job_id}/validate-conflicts")
async def validate_conflicts(
    import_job_id: uuid.UUID,
    request: UpdateDataRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Performs a fast, targeted re-validation only on the cells that were
    originally in conflict. Responds instantly with the list of remaining conflicts.
    This does NOT save any data.
    """
    # 1. Fetch the job and its original list of errors
    job = db.query(ImportJob).filter(ImportJob.id == import_job_id, ImportJob.user_id == current_user.id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")

    original_errors = job.errors or []
    if not original_errors:
        return {"conflicts": [], "message": "No original conflicts to validate."}

    # 2. Fetch the importer configuration needed for validation
    importer = db.query(Importer).filter(Importer.id == job.importer_id).first()
    if not importer:
        raise HTTPException(status_code=404, detail="Importer configuration not found")
        
    field_configs_by_key = {f['name']: f for f in importer.fields}

    # 3. Efficiently re-validate ONLY the cells that were previously in conflict
    remaining_conflicts = []
    for error in original_errors:
        if not isinstance(error, dict) or 'row' not in error or 'field' not in error:
            continue

        row_idx = error['row'] - 1  # Convert 1-based to 0-based
        field_key = error['field']
        
        # Find the column index from the original mapping to locate the new value
        column_mapping = job.column_mapping or {}
        csv_header = next((h for h, f in column_mapping.items() if f == field_key), None)
        original_headers = job.file_metadata.get('headers', [])
        
        if not csv_header or csv_header not in original_headers:
            continue
            
        col_idx = original_headers.index(csv_header)

        # Get the new value from the request data
        if row_idx < len(request.data) and col_idx < len(request.data[row_idx]):
            new_value = request.data[row_idx][col_idx]
            
            # Re-run validation on this specific cell
            if field_config := field_configs_by_key.get(field_key):
                error_message = validation_service.validate_field(new_value, field_config)
                if error_message:
                    # If it's still an error, add it to the list of remaining conflicts
                    error['value'] = new_value
                    error['error'] = error_message
                    remaining_conflicts.append(error)

    # 4. Return the list of remaining conflicts immediately
    return {
        "conflicts": remaining_conflicts,
        "resolved_count": len(original_errors) - len(remaining_conflicts)
    }


@router.post("/execute", response_model=ExecuteImportResponse)
async def execute_import(
    request: ExecuteImportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Execute an import job using the unified S3-based worker.
    
    This is Step 2 of the portal import process:
    1. Receive import_job_id and final column mapping
    2. Update the ImportJob with column mapping
    3. Enqueue the same worker that API imports use
    4. Return immediately with 202 Accepted
    
    Parameters:
        request: The import request with importer_id and column mapping
        db: Database session
        current_user: Authenticated user making the request
    
    Returns:
        Import execution results
        
    Raises:
        HTTPException: If job not found or execution fails
    """
    logger.info(f"Execute import called - import_job_id: {request.import_job_id}, importer_id: '{request.importer_id}', user: {current_user.id}")
    
    try:
        if request.import_job_id:
            # NEW WAY: Use specific job ID (preferred, no race conditions)
            import_job = db.query(ImportJob).filter(
                ImportJob.id == request.import_job_id,
                ImportJob.user_id == current_user.id
            ).first()
            
            if not import_job:
                raise HTTPException(
                    status_code=404, 
                    detail=f"Import job {request.import_job_id} not found."
                )

            # Verify the job is in the correct state for execution
            if import_job.status != ImportStatus.PENDING_VALIDATION:
                raise HTTPException(
                    status_code=400, 
                    detail=f"Import job {request.import_job_id} has status {import_job.status}. Only PENDING_VALIDATION jobs can be executed."
                )

            # Validate that the importer_id matches (extra security check)
            if str(import_job.importer_id) != request.importer_id:
                raise HTTPException(
                    status_code=400, 
                    detail="Importer ID mismatch between job and request."
                )
        else:
            # OLD WAY: Search by importer_id (temporary fallback)
            logger.warning("Using fallback job search by importer_id - frontend should be updated to send import_job_id")
            import_job = db.query(ImportJob).filter(
                ImportJob.importer_id == request.importer_id,
                ImportJob.user_id == current_user.id,
                ImportJob.status == ImportStatus.PENDING_VALIDATION  # Only allow PENDING_VALIDATION jobs
            ).order_by(ImportJob.created_at.desc()).first()
            
            if not import_job:
                raise HTTPException(
                    status_code=404, 
                    detail="No PENDING_VALIDATION import jobs found. Please upload a new file first using the upload endpoint."
                )

        # Update the ImportJob with the column mapping from the frontend
        import_job.column_mapping = request.mapping
        import_job.status = ImportStatus.PENDING  # Ready for worker processing
        
        # Store additional metadata for the worker
        import_job.file_metadata = {
            "headers": request.headers,
            "field_inclusion": request.field_inclusion,
            "total_rows": request.total_rows,
            "conflict_count": request.conflict_count,
            "portal_import": True  # Flag to indicate this came from portal
        }
        
        db.commit()
        
        # Enqueue the same worker that API imports use
        try:
            enqueue_job('app.workers.api_worker.process_api_import', import_job_id=str(import_job.id))
            logger.info(f"Portal import job {import_job.id} enqueued for processing")
            
            return ExecuteImportResponse(
                success=True,
                import_id=str(import_job.id),
                imported_rows=0,  # Will be determined by worker
                failed_rows=0,    # Will be determined by worker
                message="Import job queued for processing. Check status for results.",
                webhook_status="pending"
            )
            
        except Exception as e:
            # If enqueuing fails, mark job as FAILED
            import_job.status = ImportStatus.FAILED
            import_job.error_message = "Failed to enqueue job for processing."
            db.commit()
            logger.error(f"Failed to schedule portal import job: {e}")
            raise HTTPException(status_code=500, detail="Failed to schedule import job.")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error executing portal import: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, detail=f"Error executing import: {str(e)}"
        )


# The process_import_data function has been moved to import_service.py as process_import_data_worker


@api_key_router.post("/process", response_model=ImportProcessResponse)
async def process_import_by_key(
    request: ImportByKeyRequest,
    db: Session = Depends(get_db),
):
    """
    Process data from the CSV importer using key-based authentication.

    This endpoint allows importing data without requiring user authentication.
    Instead, it uses the importer_key for authentication and authorization.

    The endpoint expects pre-validated data from the frontend with valid and invalid rows.
    It creates an import job and enqueues it for background processing using Redis Queue.

    Args:
        request: The import request containing valid data, invalid data, and the importer key
        db: Database session dependency

    Returns:
        The created import job object

    Raises:
        HTTPException: If the importer key is invalid or the job cannot be created
    """
    # Find the importer by key
    importer = get_importer_by_key(db, request.importer_key)

    # Extract data from the request
    data = request.validData
    user_data = request.user
    metadata = request.metadata
    total_rows = len(data)

    # Create import job
    import_job = ImportJob(
        user_id=importer.user_id,  # Associate with the importer's owner
        importer_id=importer.id,
        file_name="embedded_import.csv",
        file_path="",  # No file path for frontend-processed data
        file_type="csv",
        import_source=ImportSource.API,  # API import - created via by-key endpoint
        status=ImportStatus.PROCESSING,
        row_count=total_rows,
        processed_rows=0,
        error_count=0,
    )
    db.add(import_job)
    db.commit()
    db.refresh(import_job)

    # Enqueue processing job in Redis Queue using the worker function in import_service
    job_id = enqueue_job(
        "app.services.import_service.process_import_data_worker",
        import_job_id=str(import_job.id),
        data=data,
    )

    if job_id:
        logger.info(f"Import job {import_job.id} enqueued with RQ job ID: {job_id}")
    else:
        logger.error(f"Failed to enqueue import job {import_job.id}")
        # Update job status to indicate queueing failure
        import_job.status = ImportStatus.FAILED
        import_job.error_message = "Failed to enqueue job for processing"
        db.commit()

    # Log the import started event
    log_import_started(
        importer_id=importer.id,
        import_job_id=import_job.id,
        row_count=total_rows,
        user_data=user_data,
        metadata=metadata,
    )

    # Return simplified response
    if import_job.status == ImportStatus.FAILED:
        return ImportProcessResponse(
            success=False,
        )
    else:
        return ImportProcessResponse(
            success=True,
        )


@api_key_router.get("/schema")
async def get_schema_by_key(
    importer_key: uuid.UUID,
    db: Session = Depends(get_db),
):
    """
    Fetch the schema for an importer using key-based authentication.

    This endpoint allows retrieving importer schema without requiring user authentication.
    Instead, it uses the importer_key for authentication and authorization.

    The schema includes field definitions, validation rules, and other configuration
    needed by the frontend CSV importer component.

    Args:
        importer_key: UUID of the importer to fetch schema for
        db: Database session dependency

    Returns:
        The importer schema with field definitions and configuration

    Raises:
        HTTPException: If the importer key is invalid
    """
    # Find the importer by key
    importer = get_importer_by_key(db, importer_key)

    # Convert UUID fields to strings
    importer.id = str(importer.id)
    importer.user_id = str(importer.user_id)

    return importer


@router.post("/{import_id}/ai-process", response_model=AIProcessResponse)
async def process_ai_prompt(
    import_id: uuid.UUID,
    request: AIProcessRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Process a natural language AI prompt to perform CRUD operations on import data.
    
    This endpoint provides a simple AI interface for users to interact with their data
    using natural language prompts. It supports:
    
    - READ operations: Analyze and provide insights about the data
    - UPDATE operations: Modify cell values based on patterns or conditions  
    - DELETE operations: Clear cell values based on specified criteria
    
    The AI service is guardrailed to only operate on the specified import ID
    and requires user authentication to ensure data security.
    
    Example prompts:
    - "Show me all empty phone number fields"
    - "Add +40 prefix to all phone numbers"
    - "Make all prices negative numbers"
    - "Delete all rows where email is empty"
    
    Args:
        import_id: UUID of the import to operate on
        request: The AI processing request containing the natural language prompt
        db: Database session dependency
        current_user: Authenticated user from session
        
    Returns:
        AIProcessResponse with operation details and results
        
    Raises:
        HTTPException: If import not found, access denied, or processing fails
    """
    try:
        logger.info(f"AI process request received for import {import_id} with prompt: {request.prompt[:100]}")
        
        # Convert UUID to string for processing
        import_id_str = str(import_id)
        
        # Verify the user has access to this import
        import_job = db.query(ImportJob).options(
            joinedload(ImportJob.importer)
        ).filter(
            ImportJob.id == import_id,
            ImportJob.user_id == current_user.id
        ).first()
        
        if not import_job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Import not found or access denied"
            )
        
        logger.info(f"Import job found. Status: {import_job.status}")
        logger.info(f"Has processed_data: {import_job.processed_data is not None}")
        logger.info(f"Has file_path: {import_job.file_path is not None}")
        if import_job.processed_data:
            logger.info(f"Processed data keys: {list(import_job.processed_data.keys())}")
            logger.info(f"Valid data rows: {len(import_job.processed_data.get('data', []))}")
        logger.info(f"Calling AI service...")
        
        # Initialize AI service and process the prompt
        ai_service = AIService()
        # This now gets the PLAN, it does NOT apply changes on the backend
        plan_result = await ai_service.generate_plan(
            import_job=import_job,
            prompt=request.prompt
        )
        
        logger.info(f"AI service returned result: {json.dumps(plan_result, default=str)[:500]}")
        
        if not plan_result.get("success"):
            logger.error(f"AI service failed: {plan_result.get('error')}")
            raise HTTPException(status_code=400, detail=plan_result.get("error"))

        # The result now contains the 'transformations' list, which will be sent to the frontend.
        logger.info(f"Creating AIProcessResponse with keys: {list(plan_result.keys())}")
        response = AIProcessResponse(**plan_result)
        logger.info(f"AIProcessResponse created successfully")
        return response
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing AI prompt for import {import_id}: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process AI prompt: {str(e)}"
        )

