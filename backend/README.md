# Zarnegaar API

FastAPI backend with SQLite. Run from this directory:

```bash
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Docker

Build and run this backend separately:

```bash
docker build -t zarnegaar-backend .
docker run --rm -p 8000:8000 -v zarnegaar-data:/data zarnegaar-backend
```

The Docker image stores SQLite data at `/data/zarnegaar.db`.

Optional environment variables:

```bash
DATABASE_URL=sqlite:////data/zarnegaar.db
FRONTEND_ORIGINS=http://localhost:3000,http://localhost:5173
```
