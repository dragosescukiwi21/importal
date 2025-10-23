# app/api/v1/statistics.py

import uuid
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, case, cast, Date

from app.db.base import get_db
from app.auth.users import get_current_active_user
from app.models.user import User
from app.models.import_job import ImportJob, ImportStatus
from app.models.importer import Importer

router = APIRouter()

@router.get("/dashboard")
async def get_dashboard_statistics(
    period: str = "7d",  # New parameter for time period
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get dashboard statistics for the current user using efficient, consolidated queries.
    Supports different time periods: 7d, 1m, 6m
    """
    now = datetime.utcnow()
    
    # Define time periods based on the period parameter
    if period == "7d":
        days_back = 6  # Start of the 7-day window
        days_for_trend = 7
    elif period == "1m":
        days_back = 29  # Start of the 30-day window
        days_for_trend = 30
    elif period == "6m":
        days_back = 179  # Start of the 180-day window (6 months * 30 days)
        days_for_trend = 180
    else:
        # Default to 7 days
        days_back = 6
        days_for_trend = 7
    
    period_start_date = (now - timedelta(days=days_back)).date()
    thirty_days_ago = now - timedelta(days=30)
    
    # --- EFFICIENT SINGLE QUERY FOR AGGREGATES ---
    # This query gets all high-level numbers in one database call.
    stats_query = db.query(
        func.count(Importer.id).label("total_importers"),
        func.sum(case((ImportJob.created_at >= thirty_days_ago, 1), else_=0)).label("imports_30d"),
        func.sum(case((ImportJob.status == ImportStatus.COMPLETED, 1), else_=0)).label("completed_30d"),
        func.sum(case((ImportJob.created_at >= thirty_days_ago, ImportJob.error_count), else_=0)).label("errors_30d")
    ).select_from(User).outerjoin(
        Importer, Importer.user_id == User.id
    ).outerjoin(
        ImportJob, ImportJob.user_id == User.id
    ).filter(User.id == current_user.id).group_by(User.id)
    
    main_stats = stats_query.one_or_none()

    # --- EFFICIENT TREND QUERY ---
    # Get daily counts of imports and total conflicts (sum of error_count) for the selected period
    trend_query = db.query(
        cast(ImportJob.created_at, Date).label("date"),
        func.count(ImportJob.id).label("imports"),
        func.sum(ImportJob.error_count).label("conflicts")
    ).filter(
        ImportJob.user_id == current_user.id,
        cast(ImportJob.created_at, Date) >= period_start_date
    ).group_by(
        cast(ImportJob.created_at, Date)
    ).order_by(
        cast(ImportJob.created_at, Date)
    )
    
    daily_trend_data = {row.date: row for row in trend_query.all()}

    # --- FORMAT DATA AND FILL MISSING DAYS ---
    conflicts_trend = []
    imports_trend = []
    for i in range(days_for_trend):
        target_date = period_start_date + timedelta(days=i)
        day_data = daily_trend_data.get(target_date)
        
        conflicts_trend.append({
            "date": str(target_date), 
            "value": day_data.conflicts if day_data and day_data.conflicts else 0
        })
        imports_trend.append({
            "date": str(target_date), 
            "value": day_data.imports if day_data else 0
        })

    # Calculate the total sum for the selected period from the trend data we already have
    total_conflicts_for_period = sum(item['value'] for item in conflicts_trend)
    total_imports_for_period = sum(item['value'] for item in imports_trend)
    
    # Calculate success rate for the selected period
    completed_in_period = db.query(func.count(ImportJob.id)).filter(
        ImportJob.user_id == current_user.id,
        cast(ImportJob.created_at, Date) >= period_start_date,
        ImportJob.status == ImportStatus.COMPLETED
    ).scalar() or 0
    
    success_rate_period = (completed_in_period / total_imports_for_period * 100) if total_imports_for_period > 0 else 100

    # Calculate 30-day success rate for backwards compatibility
    total_recent = main_stats.imports_30d if main_stats else 0
    completed_recent = main_stats.completed_30d if main_stats else 0
    success_rate = (completed_recent / total_recent * 100) if total_recent > 0 else 100

    return {
        "summary": {
            # Add the new period-specific totals to the summary
            "total_conflicts_period": total_conflicts_for_period,
            "total_imports_period": total_imports_for_period,
            "success_rate_period": round(success_rate_period, 1),

            # Your existing 30-day stats can remain if you need them elsewhere
            "total_importers": main_stats.total_importers if main_stats else 0,
            "total_imports_30d": total_recent,
            "total_conflicts_30d": main_stats.errors_30d if main_stats else 0,
            "success_rate_30d": round(success_rate, 1)
        },
        "trends": {
            "conflicts_period": conflicts_trend,
            "imports_period": imports_trend,
        }
    }
