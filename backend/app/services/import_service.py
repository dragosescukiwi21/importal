"""
Consolidated import service for processing CSV imports.

This module provides a unified interface for creating, managing, and processing import jobs.
It focuses on direct data imports where the data is pre-processed by the frontend.
"""
# Standard library imports
import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Union, Tuple

# Third-party imports
import pandas as pd
from sqlalchemy.orm import Session, joinedload

# Application imports
from app.db.utils import db_transaction
from app.models.import_job import ImportJob, ImportStatus
from app.models.importer import Importer
from app.services.queue import enqueue_job
from app.services.webhook import WebhookService
from app.models.webhook import WebhookEventType
from app.services.s3_service import get_s3_service
from app.core.config import settings

logger = logging.getLogger(__name__)

# Create a single instance of WebhookService
webhook_service = WebhookService()


class ImportService:
    """Unified service for handling all aspects of data imports.

    This service contains all the business logic for:
    - Creating and retrieving import jobs
    - Processing pre-validated data from the frontend
    - Sending webhook notifications
    - Managing import job status

    It's designed to be used by both API endpoints and background workers.
    """

    def __init__(self, webhook_service: WebhookService = webhook_service):
        """Initialize the import service with dependencies"""
        self.webhook_service = webhook_service

    def get_import_jobs(self, db: Session, user_id: str, skip: int = 0, limit: int = 20) -> List[ImportJob]:
        """
        Retrieve a list of import jobs for a given user.
        
        PERFORMANCE OPTIMIZATION: This query excludes the processed_data field
        which can be gigabytes for large files, significantly improving dashboard load times.

        Args:
            db (Session): The database session.
            user_id (str): The user's ID.
            skip (int, optional): Number of records to skip. Defaults to 0.
            limit (int, optional): Maximum number of records to return. Defaults to 20.

        Returns:
            List[ImportJob]: A list of ImportJob objects WITHOUT processed_data.
        """
        from sqlalchemy import text
        
        # Use a raw SQL query to exclude the heavy processed_data field
        # This dramatically improves performance for large files
        query = text("""
            SELECT 
                ij.id, ij.user_id, ij.importer_id, ij.file_name, ij.file_path,
                ij.file_type, ij.import_source, ij.status, ij.row_count, ij.processed_rows,
                ij.error_count, ij.errors, ij.column_mapping, ij.file_metadata,
                ij.error_message, ij.created_at, ij.updated_at, ij.completed_at,
                ij.valid_csv_path, ij.invalid_csv_path,
                -- Importer fields
                i.id as importer_pk_id, i.name as importer_name, i.description as importer_description
            FROM import_jobs ij
            LEFT JOIN importers i ON ij.importer_id = i.id
            WHERE ij.user_id = :user_id
            ORDER BY ij.created_at DESC
            LIMIT :limit OFFSET :skip
        """)
        
        result = db.execute(query, {"user_id": user_id, "limit": limit, "skip": skip})
        rows = result.fetchall()
        
        # Convert to ImportJob objects manually
        import_jobs = []
        for row in rows:
            # Create ImportJob object
            import_job = ImportJob(
                id=row.id,
                user_id=row.user_id, 
                importer_id=row.importer_id,
                file_name=row.file_name,
                file_path=row.file_path,
                file_type=row.file_type,
                import_source=row.import_source,
                status=row.status,
                row_count=row.row_count or 0,
                processed_rows=row.processed_rows or 0,
                error_count=row.error_count or 0,
                errors=row.errors,
                column_mapping=row.column_mapping,
                file_metadata=row.file_metadata,
                error_message=row.error_message,
                created_at=row.created_at,
                updated_at=row.updated_at,
                completed_at=row.completed_at,
                valid_csv_path=row.valid_csv_path,
                invalid_csv_path=row.invalid_csv_path,
                # Explicitly set processed_data to None to avoid accidental loading
                processed_data=None
            )
            
            # Create importer object if exists
            if row.importer_pk_id:
                importer = Importer(
                    id=row.importer_pk_id,
                    name=row.importer_name,
                    description=row.importer_description
                )
                import_job.importer = importer
            
            import_jobs.append(import_job)
        
        return import_jobs

    def get_import_job(self, db: Session, user_id: str, import_job_id: Union[str, uuid.UUID]) -> Optional[ImportJob]:
        """
        Retrieve a single import job by ID for a given user.

        Args:
            db (Session): The database session.
            user_id (str): The user's ID.
            import_job_id: The ID of the import job.

        Returns:
            Optional[ImportJob]: The ImportJob object if found, else None.
        """
        # Convert string ID to UUID if needed
        if isinstance(import_job_id, str):
            try:
                import_job_id = uuid.UUID(import_job_id)
            except ValueError:
                logger.error(f"Invalid import job ID format: {import_job_id}")
                return None

        return db.query(ImportJob).filter(
            ImportJob.id == import_job_id,
            ImportJob.user_id == user_id
        ).first()

    async def create_import_job(
        self,
        db: Session,
        user_id: str,
        importer_id: str,
        file_name: str,
        data: List[Dict[str, Any]]
    ) -> ImportJob:
        """
        Create a new import job and enqueue it for background processing.

        Args:
            db (Session): The database session.
            user_id (str): The user's ID.
            importer_id (str): The ID of the importer to use.
            file_name (str): Name to identify this import.
            data (List[Dict[str, Any]]): The data to import.

        Returns:
            ImportJob: The created ImportJob object.
        """
        try:
            # Convert string UUID to UUID object
            importer_uuid = uuid.UUID(importer_id)
            user_uuid = uuid.UUID(user_id)

            # Verify importer exists and belongs to user
            importer = db.query(Importer).filter(
                Importer.id == importer_uuid,
                Importer.user_id == user_uuid
            ).first()

            if not importer:
                raise ValueError(f"Importer with ID {importer_id} not found for user {user_id}")

            # Create import job
            total_rows = len(data)

            import_job = ImportJob(
                user_id=user_uuid,
                importer_id=importer_uuid,
                file_name=file_name,
                file_path="",  # No file path for direct data imports
                file_type="json",
                status=ImportStatus.PENDING,
                row_count=total_rows,
                processed_rows=0,
                error_count=0
            )

            # Save to database with transaction
            with db_transaction(db):
                db.add(import_job)

            # Refresh after transaction is committed
            db.refresh(import_job)

            # Enqueue the job for background processing
            job_id = enqueue_job(
                'app.workers.import_worker.process_import_job',
                import_job_id=str(import_job.id),
                data=data
            )

            logger.info(f"Created import job {import_job.id} for data import and enqueued as RQ job {job_id}")
            return import_job

        except Exception as e:
            logger.error(f"Error creating import job: {str(e)}")
            raise

    async def process_import_data(
        self,
        db: Session,
        import_job_id: str,
        data: List[Dict[str, Any]]
    ):
        """
        Processes an import job using pre-validated data (e.g., from frontend).
        """
        logger.info(f"Processing import job {import_job_id} from pre-validated data")
        import_job: Optional[ImportJob] = None
        importer: Optional[Importer] = None
        processed_df = None

        try:
            job_uuid = uuid.UUID(import_job_id)
            import_job = db.query(ImportJob).options(joinedload(ImportJob.importer)).filter(ImportJob.id == job_uuid).first()

            if not import_job:
                logger.error(f"Import job {import_job_id} not found.")
                return

            importer = import_job.importer
            if not importer:
                logger.error(f"Importer associated with job {import_job_id} not found.")
                import_job.status = ImportStatus.FAILED
                import_job.error_message = "Associated importer configuration not found."
                db.commit()
                return

            logger.info(f"Found job {import_job.id}, associated with importer {importer.id}")

            # Process the pre-validated data
            try:
                # Process each row by merging mapped and unmapped data when appropriate
                processed_rows = []
                
                for row_data in data:
                    # Start with the mapped data
                    processed_row = row_data.get('data', {}).copy()
                    
                    # Add unmapped data if the setting is enabled
                    if importer.include_unmatched_columns:
                        # Only add unmapped fields that don't conflict with mapped fields
                        unmapped_data = row_data.get('unmapped_data', {})
                        processed_row.update({k: v for k, v in unmapped_data.items() if k not in processed_row})
                    
                    processed_rows.append(processed_row)
                
                # Create DataFrame and update job status
                if processed_rows:
                    processed_df = pd.DataFrame(processed_rows)
                    import_job.processed_rows = len(processed_rows)
                    logger.info(f"Successfully processed {len(processed_rows)} rows.")
                
                import_job.status = ImportStatus.COMPLETED
                import_job.completed_at = datetime.now().astimezone()
                db.commit()
                logger.info(f"Job {import_job.id} processing completed successfully.")
                
            except Exception as process_exc:
                logger.error(f"Error processing pre-validated data for job {import_job_id}: {process_exc}", exc_info=True)
                import_job.status = ImportStatus.FAILED
                import_job.error_message = f"Error during data processing: {str(process_exc)}"
                import_job.processed_rows = 0
                db.commit()

            # Send completion webhook
            await self._send_completion_webhook(db, import_job, importer, processed_df)

        except Exception as e:
            logger.error(f"Unexpected error processing pre-validated data for job {import_job_id}: {e}", exc_info=True)
            if import_job and db.is_active:
                try:
                    import_job.status = ImportStatus.FAILED
                    import_job.error_message = f"Internal server error: {str(e)}"
                    db.commit()
                    if importer:
                        await self._send_completion_webhook(db, import_job, importer)
                except Exception as recovery_exc:
                    logger.error(f"Failed during exception recovery for job {import_job_id}: {recovery_exc}")

    async def _send_completion_webhook(
        self,
        db: Session,
        import_job: ImportJob,
        importer: Importer,
        processed_df: Optional[pd.DataFrame] = None
    ):
        """
        Sends a webhook notification for an import job completion.
        This method is a wrapper around send_webhook_notification for consistency.

        Args:
            db: Database session
            import_job: The import job
            importer: The importer configuration
            processed_df: The processed dataframe (optional)
        """
        try:
            # Use the unified webhook notification method for consistency
            await self.send_webhook_notification(
                db=db,
                import_job=import_job,
                importer=importer,
                processed_df=processed_df
            )
        except Exception as e:
            logger.error(f"Error sending webhook for job {import_job.id}: {e}", exc_info=True)

    async def send_webhook_for_portal_import(
        self,
        db: Session,
        import_job: ImportJob,
        importer: Importer,
        processed_df: Optional[pd.DataFrame] = None
    ):
        """
        Send webhook notification for portal imports.
        
        Portal imports store their data in the processed_data JSONB field.
        This method efficiently retrieves that data for webhook delivery.
        
        Args:
            db: Database session
            import_job: The portal import job
            importer: The importer configuration with webhook settings
            processed_df: Optional DataFrame from the worker (for fresh processing)
            
        Returns:
            bool: True if webhook was sent successfully, False otherwise
        """
        try:
            # Check if webhook is configured
            if not importer.webhook_enabled or not importer.webhook_url:
                logger.info(f"Webhook not enabled or URL not configured for importer {importer.id}")
                return False
            
            # Prepare base webhook payload with clean structure
            # Note: Event type determines the webhook event record type, not the payload status field
            event_type = WebhookEventType.IMPORT_FINISHED if import_job.status in [ImportStatus.COMPLETED, ImportStatus.UNCOMPLETED] else WebhookEventType.IMPORT_FAILED
            # Build webhook payload - simplified structure with data and errors only
            webhook_payload = {
                "importJobID": str(import_job.id),
                "importer_id": str(importer.id),
                "status": "completed" if import_job.status == ImportStatus.COMPLETED else "uncompleted" if import_job.status == ImportStatus.UNCOMPLETED else "failed",
                "created_at": import_job.created_at.isoformat() if import_job.created_at else datetime.now().isoformat(),
                "results": {
                    "totalRows": import_job.row_count or 0,
                    "validRows": max(0, (import_job.row_count or 0) - (import_job.error_count or 0)),
                    "errorRows": import_job.error_count or 0
                },
                "data": [],  # Valid data (limited to sample_size if truncate_data is true)
                "errors": [],  # Error/conflict data (limited to sample_size if truncate_data is true)
                "data_included": importer.include_data_in_webhook or False,
                "truncate_data": getattr(importer, 'truncate_data', False),
                "sample_size": getattr(importer, 'webhook_data_sample_size', 100) if getattr(importer, 'truncate_data', False) else None,
                "timestamp": datetime.now().isoformat(),
                "webhook_id": None  # Will be set after webhook event creation
            }
            
            # Include processed data if configured - PORTAL SPECIFIC LOGIC
            if importer.include_data_in_webhook:
                logger.info(f"Including data in portal webhook for job {import_job.id}")
                try:
                    # Check if truncation is enabled and get the sample size
                    truncate_enabled = webhook_payload["truncate_data"]
                    # If truncate_data is False, include all data (no limit)
                    # If truncate_data is True, limit to sample_size
                    sample_size = getattr(importer, 'webhook_data_sample_size', 100) if truncate_enabled else float('inf')
                    
                    logger.info(f"Webhook data settings - truncate_enabled: {truncate_enabled}, sample_size: {sample_size if sample_size != float('inf') else 'unlimited'}")
                    
                    # Portal imports: get data from processed_data field or provided DataFrame
                    clean_df = pd.DataFrame()
                    error_df = pd.DataFrame()
                    
                    if processed_df is not None and not processed_df.empty:
                        # Use provided DataFrame from worker (already clean)
                        clean_df = processed_df
                    elif import_job.processed_data:
                        # Get data from processed_data JSONB field
                        data = import_job.processed_data.get("data", [])
                        
                        if data:
                            clean_df = pd.DataFrame(data)
                    else:
                        logger.warning(f"No data source available for portal webhook for job {import_job.id}")
                    
                    # Process valid data and apply truncation if enabled
                    if not clean_df.empty:
                        valid_records = clean_df.to_dict(orient='records')
                        logger.info(f"Found {len(valid_records)} valid records for portal import")
                        
                        # Apply truncation only if enabled and data exceeds sample_size
                        if truncate_enabled and len(valid_records) > sample_size:
                            valid_records = valid_records[:int(sample_size)]
                            logger.info(f"Portal valid data truncated from {len(clean_df)} to {len(valid_records)} records")
                        
                        webhook_payload["data"] = valid_records
                    
                    # Process error data (conflicts) and apply truncation if enabled
                    if not error_df.empty and import_job.status == ImportStatus.UNCOMPLETED:
                        error_records = error_df.to_dict(orient='records')
                        logger.info(f"Found {len(error_records)} error records for portal import")
                        
                        # Apply truncation only if enabled and data exceeds sample_size
                        if truncate_enabled and len(error_records) > sample_size:
                            error_records = error_records[:int(sample_size)]
                            logger.info(f"Portal error data truncated from {len(error_df)} to {len(error_records)} records")
                        
                        webhook_payload["errors"] = error_records
                        
                except Exception as data_error:
                    logger.warning(f"Failed to include data in portal webhook: {data_error}")
                    webhook_payload["data"] = []
                    webhook_payload["errors"] = []
            else:
                # Data inclusion is disabled
                logger.info(f"Data inclusion disabled for portal importer {importer.id}")
            
            # Create and send webhook event
            webhook_event = await self.webhook_service.create_webhook_event(
                db=db,
                user_id=import_job.user_id,
                import_job_id=import_job.id,
                event_type=event_type,
                payload=webhook_payload
            )
            
            # Return success status based on delivery
            success = webhook_event and webhook_event.delivered
            if success:
                logger.info(f"Portal webhook sent successfully for import job {import_job.id}")
            else:
                logger.warning(f"Portal webhook delivery failed for import job {import_job.id}")
                
            return success
            
        except Exception as e:
            logger.error(f"Error sending portal webhook notification for job {import_job.id}: {e}", exc_info=True)
            return False

    async def send_webhook_for_api_import(
        self,
        db: Session,
        import_job: ImportJob,
        importer: Importer,
        valid_data_df: pd.DataFrame,
        failed_data_df: Optional[pd.DataFrame] = None
    ):
        """
        Send webhook notification for API imports.
        
        API imports are processed by workers that already have the data in memory.
        This method receives the clean, processed DataFrames directly from the worker,
        eliminating the need to re-read files from disk.
        
        Args:
            db: Database session
            import_job: The API import job
            importer: The importer configuration with webhook settings
            valid_data_df: DataFrame containing valid/clean data (REQUIRED)
            failed_data_df: Optional DataFrame containing failed/invalid data
            
        Returns:
            bool: True if webhook was sent successfully, False otherwise
        """
        try:
            # Check if webhook is configured
            if not importer.webhook_enabled or not importer.webhook_url:
                logger.info(f"Webhook not enabled or URL not configured for importer {importer.id}")
                return False
            
            # Prepare base webhook payload with clean structure
            # Note: Event type determines the webhook event record type, not the payload status field
            event_type = WebhookEventType.IMPORT_FINISHED if import_job.status in [ImportStatus.COMPLETED, ImportStatus.UNCOMPLETED] else WebhookEventType.IMPORT_FAILED
            # Build webhook payload - simplified structure with data and errors only
            webhook_payload = {
                "importJobID": str(import_job.id),
                "importer_id": str(importer.id),
                "status": "completed" if import_job.status == ImportStatus.COMPLETED else "uncompleted" if import_job.status == ImportStatus.UNCOMPLETED else "failed",
                "created_at": import_job.created_at.isoformat() if import_job.created_at else datetime.now().isoformat(),
                "results": {
                    "totalRows": import_job.row_count or 0,
                    "validRows": max(0, (import_job.row_count or 0) - (import_job.error_count or 0)),
                    "errorRows": import_job.error_count or 0
                },
                "data": [],  # Valid data (limited to sample_size if truncate_data is true)
                "errors": [],  # Error/conflict data (limited to sample_size if truncate_data is true)
                "data_included": importer.include_data_in_webhook or False,
                "truncate_data": getattr(importer, 'truncate_data', False),
                "sample_size": getattr(importer, 'webhook_data_sample_size', 100) if getattr(importer, 'truncate_data', False) else None,
                "timestamp": datetime.now().isoformat(),
                "webhook_id": None  # Will be set after webhook event creation
            }
            
            # Include processed data if configured - API SPECIFIC LOGIC
            if importer.include_data_in_webhook:
                logger.info(f"Including data in API webhook for job {import_job.id}")
                try:
                    # Check if truncation is enabled and get the sample size
                    truncate_enabled = webhook_payload["truncate_data"]
                    # If truncate_data is False, include all data (no limit)
                    # If truncate_data is True, limit to sample_size
                    sample_size = getattr(importer, 'webhook_data_sample_size', 100) if truncate_enabled else float('inf')
                    
                    logger.info(f"Webhook data settings - truncate_enabled: {truncate_enabled}, sample_size: {sample_size if sample_size != float('inf') else 'unlimited'}")
                    
                    # API imports: use provided DataFrames directly (no file I/O)
                    if valid_data_df is not None and not valid_data_df.empty:
                        valid_records = valid_data_df.to_dict(orient='records')
                        logger.info(f"Found {len(valid_records)} valid records for API import")
                        
                        # Apply truncation only if enabled and data exceeds sample_size
                        if truncate_enabled and len(valid_records) > sample_size:
                            valid_records = valid_records[:int(sample_size)]
                            logger.info(f"API valid data truncated from {len(valid_data_df)} to {len(valid_records)} records")
                        
                        webhook_payload["data"] = valid_records
                    else:
                        logger.warning(f"No valid data provided for API webhook for job {import_job.id}")
                    
                    # Process error data (conflicts) and apply truncation if enabled
                    if failed_data_df is not None and not failed_data_df.empty and import_job.status == ImportStatus.UNCOMPLETED:
                        error_records = failed_data_df.to_dict(orient='records')
                        logger.info(f"Found {len(error_records)} error records for API import")
                        
                        # Apply truncation only if enabled and data exceeds sample_size
                        if truncate_enabled and len(error_records) > sample_size:
                            error_records = error_records[:int(sample_size)]
                            logger.info(f"API error data truncated from {len(failed_data_df)} to {len(error_records)} records")
                        
                        webhook_payload["errors"] = error_records
                        
                except Exception as data_error:
                    logger.warning(f"Failed to include data in API webhook: {data_error}")
                    webhook_payload["data"] = []
                    webhook_payload["errors"] = []
            else:
                # Data inclusion is disabled
                logger.info(f"Data inclusion disabled for API importer {importer.id}")
            
            # Create and send webhook event
            webhook_event = await self.webhook_service.create_webhook_event(
                db=db,
                user_id=import_job.user_id,
                import_job_id=import_job.id,
                event_type=event_type,
                payload=webhook_payload
            )
            
            # Return success status based on delivery
            success = webhook_event and webhook_event.delivered
            if success:
                logger.info(f"API webhook sent successfully for import job {import_job.id}")
            else:
                logger.warning(f"API webhook delivery failed for import job {import_job.id}")
                
            return success
            
        except Exception as e:
            logger.error(f"Error sending API webhook notification for job {import_job.id}: {e}", exc_info=True)
            return False

    # Legacy method for backward compatibility
    async def send_webhook_notification(
        self,
        db: Session,
        import_job: ImportJob,
        importer: Importer,
        processed_df: Optional[pd.DataFrame] = None
    ):
        """
        Legacy webhook notification method for backward compatibility.
        Routes to appropriate specialized method based on import type.
        
        FOR NEW CODE: Use send_webhook_for_portal_import or send_webhook_for_api_import directly.
        """
        logger.warning("Using legacy send_webhook_notification method - consider migrating to specialized methods")
        
        # Determine import type and route to appropriate method
        if import_job.processed_data:
            # Portal import - has processed_data JSONB field
            return await self.send_webhook_for_portal_import(
                db=db,
                import_job=import_job,
                importer=importer,
                processed_df=processed_df
            )
        else:
            # API import - no processed_data field, requires data parameters
            if processed_df is None:
                # For API imports without processed_df (e.g., webhook resends),
                # we need to reconstruct the data from the file
                logger.info(f"API import {import_job.id} webhook called without processed data - reconstructing from file")
                
                try:
                    s3_service = get_s3_service()
                    
                    if import_job.file_path and import_job.file_path.startswith('s3://'):
                        # Read from S3
                        processed_df = s3_service.download_file_as_dataframe(
                            import_job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                        )
                        if processed_df is None:
                            logger.error(f"API import {import_job.id} file not found in S3: {import_job.file_path}")
                            return False
                    elif import_job.file_path and os.path.exists(import_job.file_path):
                        # Fallback for legacy local files
                        processed_df = pd.read_csv(import_job.file_path, dtype=str, keep_default_na=False, na_filter=False).fillna("")
                    else:
                        logger.error(f"API import {import_job.id} file not found: {import_job.file_path}")
                        return False
                    
                    # Apply column mapping if available
                    if import_job.column_mapping:
                        processed_df = processed_df.rename(columns=import_job.column_mapping)
                        logger.info(f"Applied column mapping for webhook: {import_job.column_mapping}")
                        
                except Exception as e:
                    logger.error(f"Failed to reconstruct data for API import {import_job.id}: {e}")
                    return False
            
            if processed_df.empty:
                logger.error(f"API import {import_job.id} has no data to send in webhook")
                return False
            
            # For API imports, we need to separate valid/failed data
            valid_df = processed_df
            failed_df = None
            
            # If we have errors, try to separate failed data
            if import_job.errors:
                error_indices = set()
                for error in import_job.errors:
                    if isinstance(error.get('row'), int) and error.get('row') != "Header":
                        # Convert from 1-based row number to 0-based pandas index
                        # Row 1 = first data row (DataFrame index 0), row 2 = second data row (DataFrame index 1), etc.
                        error_indices.add(error['row'] - 1)
                
                if error_indices and not processed_df.empty:
                    failed_mask = processed_df.index.isin(error_indices)
                    valid_df = processed_df[~failed_mask].copy()
                    failed_df = processed_df[failed_mask].copy()
            
            return await self.send_webhook_for_api_import(
                db=db,
                import_job=import_job,
                importer=importer,
                valid_data_df=valid_df,
                failed_data_df=failed_df
            )


# Create a singleton instance of the ImportService
import_service = ImportService()


def process_import_data_worker(
    import_job_id: str,
    data: List[Dict[str, Any]]
):
    """
    Process import data as a background job in Redis Queue.
    This function creates its own database session and handles all database operations.
    It's designed to be called by a worker process, not directly by API endpoints.
    
    Args:
        import_job_id (str): The ID of the import job as a string
        data (List[Dict[str, Any]]): List of data rows to process

    Returns:
        Dict[str, Any]: Result of the processing
    """
    # Import here to avoid circular imports
    import asyncio
    from app.db.base import SessionLocal
    
    # Create a new database session for this worker
    db = SessionLocal()

    try:
        # Use the import_service to process the data
        # We need to run the async function in a new event loop since this is a worker process
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            # Run the async function in the event loop
            loop.run_until_complete(
                import_service.process_import_data(
                    db=db,
                    import_job_id=import_job_id,
                    data=data
                )
            )
            logger.info(
                f"Successfully processed {len(data)} rows for import job {import_job_id}"
            )
            return {
                "status": "success",
                "processed_rows": len(data)
            }
        finally:
            loop.close()

    except Exception as e:
        logger.error(f"Error processing import data: {str(e)}")
        return {"status": "error", "message": str(e)}

    finally:
        # Always close the database session
        db.close()


def log_import_started(
    importer_id: uuid.UUID,
    import_job_id: uuid.UUID,
    row_count: int,
    user_data: dict = None,
    metadata: dict = None
):
    """Log an import started event.
    
    This is a simplified version that just logs the event without using webhooks.
    For actual webhook delivery, use the webhook_service directly with a DB session.
    
    Args:
        importer_id: UUID of the importer
        import_job_id: UUID of the import job
        row_count: Total number of rows in the import
        user_data: User data to include in the webhook
        metadata: Additional metadata to include
    """
    user_data = user_data or {}
    metadata = metadata or {}
    
    # Create event payload
    payload = {
        "event_type": WebhookEventType.IMPORT_STARTED,
        "import_job_id": str(import_job_id),
        "importer_id": str(importer_id),
        "row_count": row_count,
        "timestamp": datetime.now().isoformat(),
        "user": user_data,
        "metadata": metadata,
    }
    
    # Log the event
    logger.info(f"Import started: {payload}")


def cleanup_abandoned_imports(
    db: Session, 
    older_than_hours: int = 24,
    dry_run: bool = False
) -> tuple[int, list[str]]:
    """
    Delete import jobs stuck in PENDING_VALIDATION for more than X hours.
    
    These are portal uploads where the user uploaded a file but never
    completed the validation wizard. The jobs and their associated S3
    files are permanently deleted.
    
    This is ONLY for PENDING_VALIDATION status (portal uploads).
    API imports are never affected as they go straight to PENDING.
    
    Args:
        db: Database session
        older_than_hours: Delete imports older than this many hours (default: 24)
        dry_run: If True, log what would be deleted but don't actually delete
        
    Returns:
        Tuple of (deleted_count, list of deleted import IDs)
        
    Example:
        >>> from app.db.base import SessionLocal
        >>> db = SessionLocal()
        >>> count, ids = cleanup_abandoned_imports(db, older_than_hours=24)
        >>> print(f"Deleted {count} abandoned imports")
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=older_than_hours)
    
    # Find all abandoned imports
    abandoned = db.query(ImportJob).filter(
        ImportJob.status == ImportStatus.PENDING_VALIDATION,
        ImportJob.created_at < cutoff_time
    ).all()
    
    if not abandoned:
        logger.info("No abandoned imports found for cleanup")
        return 0, []
    
    logger.info(
        f"Found {len(abandoned)} abandoned import(s) older than {older_than_hours} hours "
        f"(created before {cutoff_time.isoformat()})"
    )
    
    if dry_run:
        logger.info("DRY RUN - Would delete the following imports:")
        for job in abandoned:
            logger.info(
                f"  - ID: {job.id}, File: {job.file_name}, "
                f"Created: {job.created_at.isoformat()}, User: {job.user_id}"
            )
        return len(abandoned), [str(job.id) for job in abandoned]
    
    s3_service = get_s3_service()
    deleted_count = 0
    deleted_ids = []
    failed_deletions = []
    
    for job in abandoned:
        try:
            logger.info(
                f"Deleting abandoned import {job.id} "
                f"(file: {job.file_name}, created: {job.created_at.isoformat()})"
            )
            
            # Delete S3 file if exists
            if job.file_path and job.file_path.startswith('s3://'):
                try:
                    s3_key = job.file_path.replace(f"s3://{settings.S3_BUCKET_NAME}/", "")
                    s3_service.delete_file(s3_key)
                    logger.info(f"  ✓ Deleted S3 file: {s3_key}")
                except Exception as s3_error:
                    logger.warning(
                        f"  ⚠ Failed to delete S3 file {job.file_path}: {s3_error}. "
                        "Continuing with database deletion."
                    )
            
            # Delete database record
            # Webhook events will be cascade deleted automatically
            db.delete(job)
            deleted_count += 1
            deleted_ids.append(str(job.id))
            logger.info(f"  ✓ Deleted database record for import {job.id}")
            
        except Exception as e:
            logger.error(f"  ✗ Failed to delete import {job.id}: {e}", exc_info=True)
            failed_deletions.append((str(job.id), str(e)))
    
    # Commit all deletions at once
    try:
        db.commit()
        logger.info(
            f"✓ Successfully cleaned up {deleted_count} abandoned import(s). "
            f"Failed: {len(failed_deletions)}"
        )
        
        if failed_deletions:
            logger.warning(
                f"The following imports failed to delete: "
                f"{', '.join([f'{id} ({err})' for id, err in failed_deletions])}"
            )
            
    except Exception as commit_error:
        logger.error(f"Failed to commit cleanup transaction: {commit_error}", exc_info=True)
        db.rollback()
        raise
    
    return deleted_count, deleted_ids


def get_abandoned_import_stats(db: Session, older_than_hours: int = 24) -> dict:
    """
    Get statistics about abandoned imports without deleting them.
    
    Useful for monitoring and alerting on portal uploads that were never completed.
    
    Args:
        db: Database session
        older_than_hours: Count imports older than this many hours
        
    Returns:
        Dictionary with statistics about abandoned imports
    """
    cutoff_time = datetime.utcnow() - timedelta(hours=older_than_hours)
    
    abandoned = db.query(ImportJob).filter(
        ImportJob.status == ImportStatus.PENDING_VALIDATION,
        ImportJob.created_at < cutoff_time
    ).all()
    
    if not abandoned:
        return {
            "count": 0,
            "total_files": 0,
            "oldest": None,
            "newest": None,
            "users_affected": 0
        }
    
    # Calculate statistics
    user_ids = set(str(job.user_id) for job in abandoned)
    created_times = [job.created_at for job in abandoned]
    
    return {
        "count": len(abandoned),
        "total_files": len(abandoned),
        "oldest": min(created_times).isoformat(),
        "newest": max(created_times).isoformat(),
        "users_affected": len(user_ids),
        "cutoff_time": cutoff_time.isoformat(),
        "hours_threshold": older_than_hours
    }
