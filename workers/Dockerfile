FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy worker code + static data
COPY . .

# Don't buffer stdout/stderr -- important for Docker logs
ENV PYTHONUNBUFFERED=1

CMD ["python", "worker.py"]
