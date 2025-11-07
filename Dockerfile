FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create portfolios directory if it doesn't exist
RUN mkdir -p portfolios

# Expose the port the app runs on
EXPOSE 5959

# Run the application
# For development:
# CMD ["python3", "wsgi.py"]
# For production with Gunicorn (install gunicorn in requirements.txt):
CMD ["python3", "wsgi.py"]
