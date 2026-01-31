# Resume Optimizer Project

## Overview
This project helps users optimize their resumes by analyzing them against a job description and generating insights such as match score, missing keywords, and semantic relevance. It includes a **Next.js frontend** and a **Python (FastAPI) backend**.


## Tech Stack
- **Frontend:** Next.js (React)
- **Backend:** FastAPI (Python)
- **Auth/DB:** Supabase
- **Styling:** Tailwind CSS

## Run the Frontend

bash
cd frontend
npm install
npm run dev


Open:


http://localhost:3000


## Run the Backend

bash
cd backend
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload


Backend runs at:

http://localhost:8000




## Notes
- Make sure frontend and backend are running at the same time.
- Configure your Supabase credentials in the frontend environment variables if required.