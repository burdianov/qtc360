FROM python:3.12-slim

WORKDIR /app

# System deps for pymupdf, pillow, reportlab, tesseract OCR
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev libffi-dev libjpeg-dev libfreetype6-dev \
    tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install Python deps
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-dev

# Copy source
COPY . .

# Create uploads dir
RUN mkdir -p /app/uploads

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
