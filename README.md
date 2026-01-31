# Resume Optimizer Project

## Overview
Resume Optimizer helps users analyze their resumes against a job description. It generates a match score, identifies missing keywords, and provides semantic insights. The app includes a **Next.js frontend** and a **FastAPI backend**.

---

## Tech Stack
- **Frontend:** Next.js (React)
- **Backend:** FastAPI (Python)
- **Auth/DB:** Supabase
- **Styling:** Tailwind CSS

---

## Run the Frontend

```bash
cd frontend
npm install
npm run dev
```

Open:

```
http://localhost:3000
```

---

## Run the Backend

```bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload
```

Backend runs at:

```
http://localhost:8000
```

---

## Notes
- Run frontend and backend in separate terminals.
- Configure Supabase credentials in frontend environment variables if required.
