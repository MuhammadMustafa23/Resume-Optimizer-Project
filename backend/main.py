from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from io import BytesIO
import pdfplumber
import docx
import re
import numpy as np
from sentence_transformers import SentenceTransformer
from nltk.stem import PorterStemmer
import httpx
import json
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
embedder = SentenceTransformer(MODEL_NAME)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:latest")

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB

stemmer = PorterStemmer()
STOPWORDS = {
    "the", "and", "for", "with", "this", "that", "you", "your", "are", "was", "were",
    "from", "into", "over", "under", "then", "than", "also", "about", "have", "has",
    "had", "will", "shall", "can", "could", "should", "would", "may", "might", "not",
    "but", "our", "their", "they", "them", "its", "it's", "as", "at", "by", "to",
    "in", "on", "of", "or", "an", "a", "is", "be", "we", "it"
}

SYNONYMS = {
    "ai": "artificialintelligence",
    "ml": "machinelearning",
    "nlp": "naturallanguageprocessing",
    "js": "javascript",
    "reactjs": "react",
    "nodejs": "node",
    "aws": "amazonwebservices",
    "gcp": "googlecloud",
    "db": "database",
    "sql": "sql",
    "nosql": "nosql",
}

@app.get("/health")
def health():
    return {"status": "ok"}

def extract_text_from_pdf(file_bytes: bytes) -> str:
    text = []
    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text() or ""
            text.append(page_text)
    return "\n".join(text).strip()

def extract_text_from_docx(file_bytes: bytes) -> str:
    doc = docx.Document(BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    return "\n".join(paragraphs).strip()

def normalize_text(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def keyword_pairs(text: str):
    words = normalize_text(text).split()
    pairs = []
    for w in words:
        w = SYNONYMS.get(w, w)
        if w in STOPWORDS or len(w) <= 2:
            continue
        stem = stemmer.stem(w)
        pairs.append((w, stem))
    return pairs

def split_sentences(text: str, max_sentences: int = 40) -> list:
    raw = re.split(r"[.\n]+", text)
    cleaned = [s.strip() for s in raw if len(s.strip()) > 10]
    return cleaned[:max_sentences]

def semantic_match_score(resume_text: str, job_description: str):
    resume_sents = split_sentences(resume_text, max_sentences=40)
    jd_sents = split_sentences(job_description, max_sentences=20)

    if not resume_sents or not jd_sents:
        return 0, []

    resume_emb = embedder.encode(resume_sents, normalize_embeddings=True)
    jd_emb = embedder.encode(jd_sents, normalize_embeddings=True)

    best_scores = []
    best_pairs = []
    for j_idx, j_vec in enumerate(jd_emb):
        sims = np.dot(resume_emb, j_vec)
        best_i = int(np.argmax(sims))
        best_scores.append(float(sims[best_i]))
        best_pairs.append({
            "job_sentence": jd_sents[j_idx],
            "resume_sentence": resume_sents[best_i],
            "similarity": round(float(sims[best_i]) * 100, 2),
        })

    score = round((sum(best_scores) / len(best_scores)) * 100, 2)
    top_matches = sorted(best_pairs, key=lambda x: x["similarity"], reverse=True)[:5]
    return score, top_matches

def clamp_text(text: str, max_chars: int = 4000) -> str:
    return text[:max_chars] if len(text) > max_chars else text

async def call_ollama(prompt: str) -> dict:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            res = await client.post(OLLAMA_URL, json=payload)
            res.raise_for_status()
            data = res.json()
            raw = data.get("response", "").strip()
        return json.loads(raw)
    except Exception:
        return {"summary": "AI unavailable", "missing_skills": [], "bullet_improvements": []}

@app.post("/analyze")
async def analyze_resume(
    resume: UploadFile = File(...),
    job_description: str = Form(...)
):
    file_bytes = await resume.read()

    if len(file_bytes) > MAX_FILE_SIZE:
        return {"error": "Resume file is too large. Max 5MB allowed."}

    filename = resume.filename.lower()

    if filename.endswith(".pdf"):
        resume_text = extract_text_from_pdf(file_bytes)
    elif filename.endswith(".docx") or filename.endswith(".doc"):
        resume_text = extract_text_from_docx(file_bytes)
    else:
        return {"error": "Unsupported file type. Use PDF or DOCX."}

    if not resume_text.strip():
        return {"error": "Resume appears empty or could not be read."}

    jd_pairs = keyword_pairs(job_description)
    resume_pairs = keyword_pairs(resume_text)

    if not jd_pairs:
        return {"error": "Job description is empty."}

    resume_stems = {stem for _, stem in resume_pairs}
    jd_stems = {stem for _, stem in jd_pairs}

    matched_display = sorted({raw for raw, stem in jd_pairs if stem in resume_stems})
    missing_display = sorted({raw for raw, stem in jd_pairs if stem not in resume_stems})

    match_score = round((len({s for s in jd_stems if s in resume_stems}) / len(jd_stems)) * 100)

    semantic_score, top_matches = semantic_match_score(resume_text, job_description)

    ai_prompt = f"""You are a professional resume assistant.

RESUME:
{clamp_text(resume_text, 3500)}

JOB DESCRIPTION:
{clamp_text(job_description, 2500)}

Return ONLY valid JSON with:
- "summary": a professional summary (4-6 lines)
- "missing_skills": array of 5-10 missing skills
- "bullet_improvements": array of 3 rewritten resume bullet points

Example:
{{
  "summary": "Headline: ...\\nCore Skills: ...\\nImpact: ...",
  "missing_skills": ["skill1", "skill2"],
  "bullet_improvements": ["Improved bullet 1", "Improved bullet 2"]
}}"""

    ai_result = await call_ollama(ai_prompt)

    return {
        "filename": resume.filename,
        "match_score": match_score,
        "semantic_score": semantic_score,
        "top_matches": top_matches,
        "matched_keywords": matched_display[:30],
        "missing_keywords": missing_display[:30],
        "job_description_length": len(job_description),
        "resume_text_preview": resume_text[:400],
        "ai_summary": ai_result.get("summary", ""),
        "ai_missing_skills": ai_result.get("missing_skills", []),
        "ai_bullet_improvements": ai_result.get("bullet_improvements", []),
    }
