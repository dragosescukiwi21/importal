import uuid

from fastapi_users.db import SQLAlchemyBaseUserTable
from sqlalchemy import Column, String, Boolean, DateTime, UUID, Enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
import enum

from app.db.base import Base


class PlanType(str, enum.Enum):
    FREE = "FREE"
    STARTER = "STARTER"
    PRO = "PRO"
    SCALE = "SCALE"


class User(SQLAlchemyBaseUserTable[uuid.UUID], Base):
    __tablename__ = "users"

    id = Column(UUID, primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    hashed_api_key = Column(String, nullable=True, unique=True, index=True)
    
    full_name = Column(String, nullable=True)
    plan_type = Column(Enum(PlanType), default=PlanType.FREE, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    is_superuser = Column(Boolean, default=False, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # Relationships - using simple string references
    importers = relationship("Importer", back_populates="user")
    import_jobs = relationship("ImportJob", back_populates="user")
    webhook_events = relationship("WebhookEvent", back_populates="user")
