FROM python:3.11-slim

# установить git и зависимости системы
RUN apt-get update && apt-get install -y git gcc build-essential --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# скопировать проект
COPY . /app

# установить зависимости
RUN pip install --no-cache-dir -r requirements.txt

# uvicorn
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
