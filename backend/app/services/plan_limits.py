"""
Plan limits service for managing user tier restrictions.

This service defines and enforces limits for different plan types:
- Free: 1 importer, 5 imports per month (250kb max each)
- Starter: 5 importers, 15 imports per month (1mb max each)
- Pro: 15 importers, 35 Imports per month (20mb max each)
- Scale: 100 importers, 175 imports per month (100mb max each)
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.user import User, PlanType
from app.models.importer import Importer
from app.models.import_job import ImportJob

logger = logging.getLogger(__name__)


@dataclass
class PlanLimits:
    """Data class defining the limits for each plan type."""
    max_importers: int
    max_imports_per_month: int
    max_file_size_bytes: int
    
    @property
    def max_file_size_mb(self) -> float:
        """Convert file size limit to megabytes for display."""
        return self.max_file_size_bytes / (1024 * 1024)


# Plan configuration constants
PLAN_LIMITS: Dict[PlanType, PlanLimits] = {
    PlanType.FREE: PlanLimits(
        max_importers=1,
        max_imports_per_month=5,
        max_file_size_bytes=250 * 1024  # 250kb
    ),
    PlanType.STARTER: PlanLimits(
        max_importers=5,
        max_imports_per_month=15,
        max_file_size_bytes=1 * 1024 * 1024  # 1mb
    ),
    PlanType.PRO: PlanLimits(
        max_importers=15,
        max_imports_per_month=35,
        max_file_size_bytes=20 * 1024 * 1024  # 20mb
    ),
    PlanType.SCALE: PlanLimits(
        max_importers=100,
        max_imports_per_month=175,
        max_file_size_bytes=100 * 1024 * 1024  # 100mb
    ),
}


class PlanLimitsService:
    """Service for checking and enforcing plan limits."""
    
    def get_plan_limits(self, plan_type: PlanType) -> PlanLimits:
        """Get the limits for a specific plan type."""
        return PLAN_LIMITS[plan_type]
    
    def get_user_plan_limits(self, user: User) -> PlanLimits:
        """Get the limits for a specific user's plan."""
        return self.get_plan_limits(user.plan_type)
    
    def count_user_importers(self, db: Session, user_id: str) -> int:
        """Count the number of importers for a user."""
        return db.query(Importer).filter(Importer.user_id == user_id).count()
    
    def count_user_imports_this_month(self, db: Session, user_id: str) -> int:
        """Count the number of import jobs created by user in the current month."""
        # Get the start of the current month
        now = datetime.utcnow()
        start_of_month = datetime(now.year, now.month, 1)
        
        return db.query(ImportJob).filter(
            ImportJob.user_id == user_id,
            ImportJob.created_at >= start_of_month
        ).count()
    
    def can_create_importer(self, db: Session, user: User) -> Tuple[bool, Optional[str]]:
        """
        Check if user can create a new importer.
        
        Returns:
            Tuple[bool, Optional[str]]: (can_create, error_message)
        """
        limits = self.get_user_plan_limits(user)
        current_count = self.count_user_importers(db, str(user.id))
        
        if current_count >= limits.max_importers:
            return False, f"You have reached your plan limit of {limits.max_importers} importer(s). Upgrade your plan to create more importers."
        
        return True, None
    
    def can_create_import(
        self, 
        db: Session, 
        user: User, 
        file_size_bytes: Optional[int] = None
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if user can create a new import job.
        
        Args:
            db: Database session
            user: User making the request
            file_size_bytes: Size of the file being uploaded (optional)
        
        Returns:
            Tuple[bool, Optional[str]]: (can_import, error_message)
        """
        limits = self.get_user_plan_limits(user)
        
        # Check monthly import limit
        current_imports = self.count_user_imports_this_month(db, str(user.id))
        if current_imports >= limits.max_imports_per_month:
            return False, f"You have reached your monthly limit of {limits.max_imports_per_month} imports. Upgrade your plan or wait until next month."
        
        # Check file size limit if provided
        if file_size_bytes is not None and file_size_bytes > limits.max_file_size_bytes:
            return False, f"File size ({file_size_bytes / (1024 * 1024):.1f}MB) exceeds your plan limit of {limits.max_file_size_mb:.1f}MB. Upgrade your plan to upload larger files."
        
        return True, None
    
    def get_usage_summary(self, db: Session, user: User) -> Dict[str, Any]:
        """
        Get a summary of user's current usage against their plan limits.
        
        Returns:
            Dict containing usage information
        """
        limits = self.get_user_plan_limits(user)
        
        current_importers = self.count_user_importers(db, str(user.id))
        current_imports = self.count_user_imports_this_month(db, str(user.id))
        
        return {
            "plan_type": user.plan_type.value,
            "limits": {
                "max_importers": limits.max_importers,
                "max_imports_per_month": limits.max_imports_per_month,
                "max_file_size_mb": limits.max_file_size_mb,
                "max_file_size_bytes": limits.max_file_size_bytes,
            },
            "usage": {
                "importers": {
                    "current": current_importers,
                    "max": limits.max_importers,
                    "percentage": min(100, (current_importers / limits.max_importers) * 100)
                },
                "imports_this_month": {
                    "current": current_imports,
                    "max": limits.max_imports_per_month,
                    "percentage": min(100, (current_imports / limits.max_imports_per_month) * 100)
                }
            },
            "can_create_importer": current_importers < limits.max_importers,
            "can_create_import": current_imports < limits.max_imports_per_month,
        }
    
    def validate_file_size(self, plan_type: PlanType, file_size_bytes: int) -> Tuple[bool, Optional[str]]:
        """
        Validate if file size is within plan limits.
        
        Args:
            plan_type: User's plan type
            file_size_bytes: Size of the file in bytes
        
        Returns:
            Tuple[bool, Optional[str]]: (is_valid, error_message)
        """
        limits = self.get_plan_limits(plan_type)
        
        if file_size_bytes > limits.max_file_size_bytes:
            return False, f"File size ({file_size_bytes / (1024 * 1024):.1f}MB) exceeds your plan limit of {limits.max_file_size_mb:.1f}MB. Please upgrade your plan to upload larger files."
        
        return True, None


# Global service instance
plan_limits_service = PlanLimitsService()