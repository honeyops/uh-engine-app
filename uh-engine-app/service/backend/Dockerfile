FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend application
COPY . .

# Set Python path to include the project root
ENV PYTHONPATH=/app

# Expose port
EXPOSE 8000

# Command to run the FastAPI app using the module path
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
