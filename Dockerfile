FROM python:3.11-slim

# Cambiar los mirrors de HTTP a HTTPS antes de actualizar
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/debian_version && \
    sed -i 's|http://.*\.debian\.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources || true && \
    if [ -f /etc/apt/sources.list ]; then sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list; fi

# Install system dependencies (FFmpeg is required by pydub for audio conversion and slicing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy dependency definition
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose the port Flask runs on
EXPOSE 5000

# Set environment variables
ENV FLASK_APP=app.py
ENV FLASK_RUN_HOST=0.0.0.0

# Start Flask application
CMD ["python", "app.py"]
