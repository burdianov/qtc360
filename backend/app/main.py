import logging
from functools import wraps

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter as _APIRouter, APIRoute
from starlette.middleware.base import BaseHTTPMiddleware

# ── FastAPI 0.136 compatibility ─────────────────────────────────────────────
# 0.136 rejects include_router when both the include prefix and a route path
# are empty.  The check is too strict when the parent router has its own
# prefix (the combined URL cannot be empty).  We patch to skip the check
# in that case by calling add_api_route for each child route directly.

_orig_include_router = _APIRouter.include_router


@wraps(_orig_include_router)
def _include_router(self: _APIRouter, router: _APIRouter, **kwargs):  # type: ignore[no-untyped-def]
    prefix: str = kwargs.get("prefix", "")
    if not prefix and self.prefix:
        # Parent has its own prefix — the combined URL won't be empty.
        # Use add_api_route directly to avoid the empty-path check.
        tags = kwargs.get("tags")
        dependencies = kwargs.get("dependencies")
        responses = kwargs.get("responses") or {}
        deprecated = kwargs.get("deprecated")
        include_in_schema = kwargs.get("include_in_schema", True)
        callbacks = kwargs.get("callbacks")
        generate_unique_id_function = kwargs.get("generate_unique_id_function")
        for route in router.routes:
            if isinstance(route, APIRoute):
                self.add_api_route(
                    route.path,
                    route.endpoint,
                    response_model=route.response_model,
                    status_code=route.status_code,
                    tags=(tags or []) + (route.tags or []),
                    dependencies=(dependencies or []) + (route.dependencies or []),
                    summary=route.summary,
                    description=route.description,
                    response_description=route.response_description,
                    responses={**responses, **route.responses},
                    deprecated=route.deprecated or deprecated,
                    methods=route.methods,
                    operation_id=route.operation_id,
                    response_model_include=route.response_model_include,
                    response_model_exclude=route.response_model_exclude,
                    response_model_by_alias=route.response_model_by_alias,
                    response_model_exclude_unset=route.response_model_exclude_unset,
                    response_model_exclude_defaults=route.response_model_exclude_defaults,
                    response_model_exclude_none=route.response_model_exclude_none,
                    include_in_schema=route.include_in_schema and include_in_schema,
                    response_class=route.response_class,
                    name=route.name,
                    route_class_override=type(route),
                    callbacks=(callbacks or []) + (route.callbacks or []),
                    openapi_extra=route.openapi_extra,
                    generate_unique_id_function=route.generate_unique_id_function
                    or generate_unique_id_function,
                )
            elif hasattr(route, "methods"):
                self.add_route(
                    route.path,
                    route.endpoint,
                    methods=list(route.methods or []),
                    include_in_schema=route.include_in_schema,
                    name=route.name,
                )
            else:
                self.routes.append(route)
        return None
    return _orig_include_router(self, router, **kwargs)


_APIRouter.include_router = _include_router  # type: ignore[method-assign]

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
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if _is_prod:
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        return response


app.add_middleware(SecurityHeadersMiddleware)


app.include_router(v1_router)


@app.get("/")
async def root():
    return {"message": "QTC360 API", "docs": "/docs" if not _is_prod else None}
