import logging
import os

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import settings


logging.basicConfig(level=logging.INFO)


_is_prod = settings.environment.lower() == "production"


app = FastAPI(
    title="QTC360 API",
    description="Enterprise QA/QC + Commissioning Management Platform",
    version="0.1.0",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    expose_headers=["Content-Disposition"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set conservative defaults so responses are not trivially MIME-sniffed,
    framed, or leaked across origins. CSP intentionally permissive — this is an API."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        if _is_prod:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


app.add_middleware(SecurityHeadersMiddleware)


app.include_router(v1_router)


@app.get("/")
async def root():
    return {"message": "QTC360 API", "docs": "/docs" if not _is_prod else None}
