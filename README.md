# Zarnegaar

ساختار پروژه جدا شده است:

- `frontend`: همه فایل‌های فرانت‌اند، شامل React، Vite، CSS، HTML، `package.json` و `package-lock.json`
- `backend`: همه فایل‌های بک‌اند، شامل FastAPI، تنظیمات API، دیتابیس SQLite و وابستگی‌های Python

اجرای فرانت‌اند:

```bash
cd frontend
npm install
npm run dev
```

اجرای بک‌اند:

```bash
cd backend
python -m venv .venv
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

اجرای جداگانه با Docker:

بک‌اند:

```bash
docker build -t zarnegaar-backend ./backend
docker run --rm -p 8000:8000 -v zarnegaar-data:/data zarnegaar-backend
```

فرانت‌اند:

```bash
docker build -t zarnegaar-frontend ./frontend
docker run --rm -p 3000:80 zarnegaar-frontend
```

بعد از اجرا:

- فرانت‌اند: `http://localhost:3000`
- بک‌اند: `http://localhost:8000`
- سلامت API: `http://localhost:8000/api/health`
