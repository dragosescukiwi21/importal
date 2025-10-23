import logging
import uuid
from typing import Optional, List, Dict, Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.db.utils import db_transaction
from app.models.importer import Importer
from app.models.import_job import ImportJob as ImportJobModel
from app.models.webhook import WebhookEvent
from app.schemas.importer import ImporterCreate, ImporterUpdate

logger = logging.getLogger(__name__)

def _validate_webhook_url(url: Optional[str]) -> Optional[str]:
    """Validate and normalize webhook URL"""
    if not url:
        return url

    if not (url.startswith('http://') or url.startswith('https://')):
        return f"https://{url}"
    return url


def _process_fields(fields: List[Any]) -> List[Dict[str, Any]]:
    """Process fields to ensure they are dictionaries"""
    fields_json = []
    for field in fields:
        if hasattr(field, 'model_dump'):
            # Pydantic v2
            fields_json.append(field.model_dump())
        elif hasattr(field, 'dict'):
            # Pydantic v1
            fields_json.append(field.dict())
        else:
            # Already a dictionary
            fields_json.append(field)
    return fields_json


def get_importers(db: Session, user_id: str, skip: int = 0, limit: int = 50) -> List[Importer]:
    """
    Retrieve a list of importers for a given user.
    
    PERFORMANCE OPTIMIZATION: Uses optimized query for dashboard loading.
    
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        skip (int, optional): Number of records to skip. Defaults to 0.
        limit (int, optional): Maximum number of records to return. Defaults to 50.
    Returns:
        List[Importer]: A list of Importer objects.
    """
    # Add index hints and reduce default limit for better performance
    return db.query(Importer).filter(
        Importer.user_id == user_id
    ).order_by(
        Importer.created_at.desc()
    ).offset(skip).limit(limit).all()


def create_importer(db: Session, user_id: str, importer_in: ImporterCreate) -> Importer:
    """
    Create a new importer for a user.
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        importer_in (ImporterCreate): The importer creation schema.
    Returns:
        Importer: The created Importer object.
    """
    try:
        # Log the incoming fields for debugging
        logger.info(f"Creating importer with fields: {importer_in.fields}")
        
        # Process fields to ensure they are dictionaries
        fields_json = _process_fields(importer_in.fields)
        
        # Log the processed fields
        logger.info(f"Processed fields_json: {fields_json}")

        # Validate webhook URL
        webhook_url = _validate_webhook_url(importer_in.webhook_url)

        importer = Importer(
            name=importer_in.name,
            description=importer_in.description,
            fields=fields_json,
            user_id=user_id,
            webhook_url=webhook_url,
            webhook_enabled=importer_in.webhook_enabled,
            include_data_in_webhook=importer_in.include_data_in_webhook,
            truncate_data=importer_in.truncate_data,
            webhook_data_sample_size=importer_in.webhook_data_sample_size,
            include_unmatched_columns=importer_in.include_unmatched_columns,
            filter_invalid_rows=importer_in.filter_invalid_rows,
            disable_on_invalid_rows=importer_in.disable_on_invalid_rows
        )

        # Add and commit in the transaction
        with db_transaction(db):
            db.add(importer)
            
        # Refresh after the transaction is committed
        db.refresh(importer)
        
        # Log what's actually stored in the database
        logger.info(f"Importer created with ID: {importer.id}")
        logger.info(f"Fields from database: {importer.fields}")
        
        return importer
    except Exception as e:
        logger.error(f"Error creating importer: {str(e)}")
        raise


def get_importer(db: Session, user_id: str, importer_id) -> Optional[Importer]:
    """
    Retrieve a single importer by ID for a given user.
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        importer_id: The ID of the importer.
    Returns:
        Optional[Importer]: The Importer object if found, else None.
    """
    return db.query(Importer).filter(Importer.id == importer_id, Importer.user_id == user_id).first()


def update_importer(db: Session, user_id: str, importer_id, importer_in: ImporterUpdate) -> Optional[Importer]:
    """
    Update an existing importer for a user.
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        importer_id: The ID of the importer to update.
        importer_in (ImporterUpdate): The importer update schema.
    Returns:
        Optional[Importer]: The updated Importer object if found, else None.
    """
    try:
        importer = get_importer(db, user_id, importer_id)
        if not importer:
            return None

        # Get update data, handling both Pydantic v1 and v2
        # We need to handle fields separately to ensure validation_format is preserved
        fields_data = None
        if importer_in.fields is not None:
            fields_data = _process_fields(importer_in.fields)
        
        if hasattr(importer_in, 'model_dump'):
            # For Pydantic v2, get all fields except those that are explicitly None
            update_data = importer_in.model_dump(exclude_none=True)
        else:
            # For Pydantic v1, get all fields except those that are explicitly None
            update_data = importer_in.dict(exclude_none=True)

        # If we have processed fields data, use it; otherwise, process fields from update_data
        if fields_data is not None:
            update_data["fields"] = fields_data
        elif "fields" in update_data and update_data["fields"]:
            update_data["fields"] = _process_fields(update_data["fields"])

        # Validate webhook URL if present
        if 'webhook_url' in update_data:
            update_data['webhook_url'] = _validate_webhook_url(update_data['webhook_url'])

        # Update fields
        for field, value in update_data.items():
            setattr(importer, field, value)
            if field == "fields":
                flag_modified(importer, "fields")

        # Add and commit in the transaction
        with db_transaction(db):
            db.add(importer)
            
        # Refresh after the transaction is committed
        db.refresh(importer)
        return importer
    except Exception as e:
        logger.error(f"Error updating importer {importer_id}: {str(e)}")
        raise


def delete_importer(db: Session, user_id: str, importer_id) -> Optional[Importer]:
    """
    Delete an importer for a user.
    This will cascade delete all related import jobs and webhook events.
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        importer_id: The ID of the importer to delete.
    Returns:
        Optional[Importer]: The deleted Importer object if found and deleted, else None.
    """
    try:
        importer = get_importer(db, user_id, importer_id)
        if importer:
            with db_transaction(db):
                # Delete related webhook events first
                db.query(WebhookEvent).filter(
                    WebhookEvent.import_job_id.in_(
                        db.query(ImportJobModel.id).filter(ImportJobModel.importer_id == importer_id)
                    )
                ).delete(synchronize_session=False)
                
                # Delete related import jobs
                db.query(ImportJobModel).filter(
                    ImportJobModel.importer_id == importer_id,
                    ImportJobModel.user_id == user_id
                ).delete(synchronize_session=False)
                
                # Finally delete the importer
                db.delete(importer)
        return importer
    except Exception as e:
        logger.error(f"Error deleting importer {importer_id}: {str(e)}", exc_info=True)
        raise

def batch_delete_importers(db: Session, user_id: str, importer_ids: List[str]) -> int:
    """
    Delete multiple importers at once.
    Args:
        db (Session): The database session.
        user_id (str): The user's ID.
        importer_ids: List of importer IDs to delete.
    Returns:
        int: Number of importers deleted.
    """
    try:
        with db_transaction(db):
            result = db.query(Importer).filter(
                Importer.id.in_(importer_ids),
                Importer.user_id == user_id
            ).delete(synchronize_session=False)
        return result
    except Exception as e:
        logger.error(f"Error batch deleting importers: {str(e)}")
        raise


def get_importer_by_key(db: Session, importer_key: uuid.UUID) -> Importer:
    """Helper function to get an importer by key and handle common error cases.

    Args:
        db: Database session
        importer_key: UUID key of the importer

    Returns:
        Importer object if found

    Raises:
        HTTPException: If importer not found
    """
    importer = db.query(Importer).filter(Importer.key == importer_key).first()
    if not importer:
        msg = f"Importer with key {importer_key} not found"
        raise HTTPException(status_code=404, detail=msg)
    return importer
