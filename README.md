# Repo-Graph-Visualizer

FastAPI приложение для визуализации использования классов и функций в git-репозитории.

## Запуск

Собрать образ (в каталоге с `Dockerfile`):

`docker build -t repo-graph-visualizer .`
`docker run -p 8000:8000 repo-graph-visualizer`


Открой `http://localhost:8000` и вставь ссылку на публичный GitHub-репозиторий.
