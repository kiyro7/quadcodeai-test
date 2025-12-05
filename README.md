# Code Graph Visualizer (FastAPI)

## Что делает
Клонирует публичный GitHub репозиторий (.git) и статически анализирует файлы `.py`. Строит граф определений (классы/функции) и использований между ними. Отображает интерактивную SVG-визуализацию с подсветкой соседей.

## Запуск

### Docker (рекомендуется)
- `docker build -t code-graph-fastapi .`
- `docker run -p 8000:8000 code-graph-fastapi`

### Локально
- `python -m venv .venv`
- `source .venv/bin/activate`
- `pip install -r requirements.txt`
- `uvicorn main:app --reload`

## Открыть http://localhost:8000/
