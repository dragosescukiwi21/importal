import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from app.db.base import get_db
from app.auth.users import get_current_active_user
from app.models.user import User
from app.schemas.importer import ImporterCreate, ImporterUpdate, Importer as ImporterSchema
from app.services import importer as importer_service
from app.services.plan_limits import plan_limits_service

router = APIRouter()

@router.get("/", response_model=List[ImporterSchema])
async def read_importers(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_active_user),
):
    """
    Retrieve importers
    """
    return importer_service.get_importers(db, str(current_user.id), skip, limit)


@router.post("/", response_model=ImporterSchema)
async def create_importer(
    importer_in: ImporterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create new importer
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Log the incoming request
    logger.info(f"[API] Incoming importer creation request: {importer_in}")
    
    # Check plan limits before creating importer
    can_create, error_message = plan_limits_service.can_create_importer(db, current_user)
    if not can_create:
        logger.warning(f"User {current_user.id} ({current_user.plan_type}) cannot create importer: {error_message}")
        raise HTTPException(status_code=403, detail=error_message)
    
    # Create the importer
    created_importer = importer_service.create_importer(db, str(current_user.id), importer_in)
    
    # Log what we're about to return
    logger.info(f"[API] Returning importer with fields: {created_importer.fields}")
    
    return created_importer


@router.get("/{importer_id}", response_model=ImporterSchema)
async def read_importer(
    importer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get importer by ID
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[API] Fetching importer {importer_id} for user {current_user.id}")
    importer = importer_service.get_importer(db, str(current_user.id), importer_id)
    if not importer:
        raise HTTPException(status_code=404, detail="Importer not found")
    
    logger.info(f"[API] Importer {importer_id} found with {len(importer.fields)} fields")
    logger.info(f"[API] Field names: {[f.get('name') for f in importer.fields]}")
    
    return importer


@router.put("/{importer_id}", response_model=ImporterSchema)
async def update_importer(
    importer_id: uuid.UUID,
    importer_in: ImporterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Update an importer
    """
    importer = importer_service.update_importer(db, str(current_user.id), importer_id, importer_in)
    if not importer:
        raise HTTPException(status_code=404, detail="Importer not found")
    return importer

@router.delete("/{importer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_importer(
    importer_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Delete an importer
    """
    importer = importer_service.delete_importer(db, str(current_user.id), importer_id)
    if not importer:
        raise HTTPException(status_code=404, detail="Importer not found")
    return None
