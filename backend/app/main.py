from contextlib import asynccontextmanager
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text

BASE_DIR = Path(__file__).resolve().parent.parent
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'zarnegaar.db'}")
FRONTEND_ORIGINS = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",") if origin.strip()]
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

@asynccontextmanager
async def lifespan(app: FastAPI):
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE IF NOT EXISTS healthcheck (id INTEGER PRIMARY KEY, status TEXT NOT NULL)"))
    yield

app = FastAPI(title="زرنگار API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "zarnegaar-api"}
