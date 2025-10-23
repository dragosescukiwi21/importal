from fastapi import APIRouter

from app.api.v1 import auth, importers, imports, statistics, stripe_endpoints

api_router = APIRouter()

# Include all API routes
# Auth routes (FastAPI-Users authentication)
api_router.include_router(auth.router, prefix="/v1/auth", tags=["Authentication"])

# Other API routes
api_router.include_router(importers.router, prefix="/v1/importers", tags=["Importers"])

# Statistics routes
api_router.include_router(statistics.router, prefix="/v1/statistics", tags=["Statistics"])

# Stripe routes
api_router.include_router(stripe_endpoints.router, prefix="/v1", tags=["Stripe"])

# --- CORRECTED ROUTES ---

# Portal-based imports (for the interactive UI - user session auth)
api_router.include_router(imports.router, prefix="/v1/imports", tags=["Portal Imports"])

# API key authenticated routes (for programmatic access - API key auth)
api_router.include_router(imports.api_key_router, prefix="/v1/api/imports", tags=["API Imports"])
