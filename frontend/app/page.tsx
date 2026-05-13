"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { jsPDF } from "jspdf";
import {
  Chart as ChartJS,
  ArcElement,
  RadialLinearScale,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
} from "chart.js";
import { Doughnut, Radar, Bar } from "react-chartjs-2";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { supabase } from "../lib/supabaseClient";

ChartJS.register(
  ArcElement, RadialLinearScale, BarElement, CategoryScale,
  LinearScale, Tooltip, Legend, PointElement, LineElement
);

type AnalyzeResult = {
  match_score: number;
  semantic_score?: number;
  top_matches?: { job_sentence: string; resume_sentence: string; similarity: number }[];
  matched_keywords: string[];
  missing_keywords: string[];
  filename: string;
  ai_summary?: string;
  ai_missing_skills?: string[];
  ai_bullet_improvements?: string[];
};

type HistoryItem = {
  id: string;
  timestamp: string;
  jobTitle: string;
  jobDescription: string;
  result: AnalyzeResult;
};

type Tab = "overview" | "keywords" | "ai" | "charts" | "export";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
const signUp = (email: string, pw: string) => supabase.auth.signUp({ email, password: pw });
const signIn = (email: string, pw: string) => supabase.auth.signInWithPassword({ email, password: pw });
const signOut = () => supabase.auth.signOut();

async function saveSession(jobTitle: string, jobDescription: string, result: AnalyzeResult) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase.from("resume_sessions").insert([{
    user_id: user.id,
    job_title: jobTitle || jobDescription.slice(0, 120),
    score: result.match_score,
    skills: {
      matched_keywords: result.matched_keywords,
      missing_keywords: result.missing_keywords,
      semantic_score: result.semantic_score ?? 0,
    },
  }]);
}

// ─── Score Ring ───────────────────────────────────────────────────────────────
function ScoreRing({ value, label, color }: { value: number; label: string; color: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (progress / 100) * circumference;

  const gradId = `grad-${label.replace(/\s/g, "")}`;
  const [startColors] = useState<[string, string]>(() => {
    if (color === "indigo") return ["#818cf8", "#6366f1"];
    if (color === "purple") return ["#c084fc", "#a855f7"];
    return ["#34d399", "#10b981"];
  });

  return (
    <div className="flex flex-col items-center gap-2 fade-in-up">
      <svg width="120" height="120">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={startColors[0]} />
            <stop offset="100%" stopColor={startColors[1]} />
          </linearGradient>
        </defs>
        <circle cx="60" cy="60" r={radius} stroke="#1e1b4b" strokeWidth="10" fill="transparent" />
        <circle
          cx="60" cy="60" r={radius}
          stroke={`url(#${gradId})`} strokeWidth="10" fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
          className="ring-fill"
        />
        <text x="60" y="64" textAnchor="middle" fontSize="22" fill="white" fontWeight="700">
          {progress}%
        </text>
      </svg>
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ─── Keyword Pill ─────────────────────────────────────────────────────────────
function Pill({ text, variant }: { text: string; variant: "green" | "red" | "yellow" }) {
  const styles = {
    green: "bg-emerald-900/40 text-emerald-300 border border-emerald-700/50",
    red: "bg-red-900/40 text-red-300 border border-red-700/50",
    yellow: "bg-amber-900/40 text-amber-300 border border-amber-700/50",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[variant]}`}>
      {text}
    </span>
  );
}

// ─── Tab Button ───────────────────────────────────────────────────────────────
function TabBtn({ id, label, active, onClick, icon }: {
  id: Tab; label: string; active: boolean; onClick: () => void; icon: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap
        ${active
          ? "text-indigo-300 tab-active"
          : "text-slate-400 hover:text-slate-200"
        }`}
    >
      <span>{icon}</span>
      {label}
    </button>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  const handle = async () => {
    setLoading(true); setMsg("");
    const { error } = mode === "signin"
      ? await signIn(email, password)
      : await signUp(email, password);
    setLoading(false);
    if (error) { setMsg(error.message); return; }
    setMsg(mode === "signin" ? "Signed in!" : "Check your email to confirm.");
    if (mode === "signin") setTimeout(onClose, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-sm rounded-2xl bg-slate-800 border border-slate-700 p-6 shadow-2xl fade-in-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-white">
            {mode === "signin" ? "Sign In" : "Create Account"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">✕</button>
        </div>

        <div className="flex rounded-xl bg-slate-900 p-1 mb-5">
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition-colors
                ${mode === m ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"}`}
            >
              {m === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <input
            className="w-full rounded-xl bg-slate-900 border border-slate-600 px-4 py-2.5 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Email address"
            type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-xl bg-slate-900 border border-slate-600 px-4 py-2.5 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Password"
            type="password" value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handle()}
          />
        </div>

        {msg && (
          <p className={`mt-3 text-sm rounded-xl px-3 py-2 ${msg.includes("!") || msg.includes("email") ? "bg-emerald-900/50 text-emerald-300" : "bg-red-900/50 text-red-300"}`}>
            {msg}
          </p>
        )}

        <button
          onClick={handle} disabled={loading}
          className="mt-4 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          {loading ? "Please wait…" : mode === "signin" ? "Sign In" : "Create Account"}
        </button>
      </div>
    </div>
  );
}

// ─── Drop Zone ────────────────────────────────────────────────────────────────
function DropZone({ file, onChange }: { file: File | null; onChange: (f: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && (f.name.endsWith(".pdf") || f.name.endsWith(".docx") || f.name.endsWith(".doc"))) {
      onChange(f);
    }
  }, [onChange]);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-all
        ${dragging
          ? "border-indigo-400 bg-indigo-900/30"
          : file
            ? "border-emerald-500/60 bg-emerald-900/20"
            : "border-slate-600 bg-slate-800/50 hover:border-indigo-500 hover:bg-slate-800"
        }`}
    >
      <input
        ref={inputRef}
        type="file" accept=".pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
      {file ? (
        <div className="flex flex-col items-center gap-2">
          <span className="text-3xl">📄</span>
          <p className="text-emerald-400 font-semibold text-sm">{file.name}</p>
          <p className="text-slate-500 text-xs">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <span className="text-4xl text-slate-500">⬆️</span>
          <p className="text-slate-300 font-medium text-sm">Drop your resume here</p>
          <p className="text-slate-500 text-xs">PDF or DOCX · Max 5MB</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [resume, setResume] = useState<File | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [showAuth, setShowAuth] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setShowAuth(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("resume_history");
    if (stored) setHistory(JSON.parse(stored));

    const params = new URLSearchParams(window.location.search);
    const encoded = params.get("report");
    if (encoded) {
      try {
        const decoded = JSON.parse(atob(decodeURIComponent(encoded)));
        setResult(decoded.result);
        setJobDescription(decoded.jobDescription);
        setJobTitle(decoded.jobTitle ?? "");
      } catch { /* invalid link */ }
    }
  }, []);

  const saveHistory = (item: HistoryItem) => {
    const updated = [item, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem("resume_history", JSON.stringify(updated));
  };

  const handleAnalyze = async () => {
    setError("");
    if (!user) { setShowAuth(true); return; }
    if (!resume) { setError("Please upload your resume."); return; }
    if (!jobDescription.trim()) { setError("Please paste the job description."); return; }
    if (resume.size > 5 * 1024 * 1024) { setError("File too large. Max 5MB."); return; }

    const formData = new FormData();
    formData.append("resume", resume);
    formData.append("job_description", jobDescription);

    setLoading(true);
    setResult(null);
    setActiveTab("overview");

    const steps = [
      "Parsing resume…",
      "Extracting keywords…",
      "Running semantic analysis…",
      "Generating AI insights…",
    ];
    let i = 0;
    setLoadingStep(steps[0]);
    const interval = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setLoadingStep(steps[i]);
    }, 8000);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error) { setError(data.error); return; }
      setResult(data);
      await saveSession(jobTitle, jobDescription, data);
      saveHistory({
        id: String(Date.now()),
        timestamp: new Date().toLocaleString(),
        jobTitle,
        jobDescription,
        result: data,
      });
    } catch {
      setError("Failed to reach backend. Is it running on port 8000?");
    } finally {
      clearInterval(interval);
      setLoading(false);
      setLoadingStep("");
    }
  };

  const buildFullReportText = () => {
    if (!result) return "";
    return [
      "Resume Analysis Report",
      "======================",
      `File: ${result.filename}`,
      jobTitle ? `Job Title: ${jobTitle}` : "",
      `Match Score: ${result.match_score}%`,
      `Semantic Score: ${result.semantic_score ?? "—"}%`,
      "",
      `Matched Keywords (${result.matched_keywords.length}): ${result.matched_keywords.join(", ")}`,
      "",
      `Missing Keywords (${result.missing_keywords.length}): ${result.missing_keywords.join(", ")}`,
      "",
      "AI Summary:",
      result.ai_summary ?? "",
      "",
      "AI Missing Skills:",
      (result.ai_missing_skills ?? []).join("\n"),
      "",
      "AI Bullet Improvements:",
      (result.ai_bullet_improvements ?? []).join("\n"),
      "",
      "Job Description:",
      jobDescription,
    ].filter(Boolean).join("\n");
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({ jobTitle, jobDescription, result }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "resume-analysis.json"; a.click();
  };

  const downloadPdf = () => {
    if (!result) return;
    const doc = new jsPDF();
    doc.text(doc.splitTextToSize(buildFullReportText(), 180), 10, 10);
    doc.save("resume-analysis.pdf");
  };

  const downloadTxt = () => {
    if (!result) return;
    const blob = new Blob([buildFullReportText()], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "resume-analysis.txt"; a.click();
  };

  const downloadDocx = async () => {
    if (!result) return;
    const doc = new Document({
      sections: [{
        children: buildFullReportText().split("\n").map((line) => new Paragraph({ children: [new TextRun(line)] })),
      }],
    });
    const blob = await Packer.toBlob(doc);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "resume-analysis.docx"; a.click();
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopyMessage("Copied!"); }
    catch { setCopyMessage("Failed"); }
    setTimeout(() => setCopyMessage(""), 1500);
  };

  const copyShareLink = () => {
    if (!result) return;
    const encoded = encodeURIComponent(btoa(JSON.stringify({ result, jobDescription, jobTitle })));
    copyToClipboard(`${window.location.origin}${window.location.pathname}?report=${encoded}`);
  };

  const highlightedJD = useMemo(() => {
    if (!result?.missing_keywords?.length) return <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">{jobDescription}</p>;
    const missingSet = new Set(result.missing_keywords.map((k) => k.toLowerCase()));
    return (
      <p className="text-slate-300 leading-relaxed whitespace-pre-wrap">
        {jobDescription.split(/\b/).map((word, i) => {
          const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (clean && missingSet.has(clean)) {
            return <mark key={i} className="rounded bg-red-500/30 px-0.5 text-red-300 not-italic">{word}</mark>;
          }
          return <span key={i}>{word}</span>;
        })}
      </p>
    );
  }, [jobDescription, result]);

  const doughnutData = useMemo(() => result ? {
    labels: ["Matched", "Missing"],
    datasets: [{
      data: [result.matched_keywords.length, result.missing_keywords.length],
      backgroundColor: ["#10b981", "#f43f5e"],
      borderWidth: 0,
      hoverOffset: 8,
    }],
  } : null, [result]);

  const radarData = useMemo(() => result ? {
    labels: ["Match Score", "Semantic", "Matched KW", "Missing KW"],
    datasets: [{
      label: "Score",
      data: [
        result.match_score,
        result.semantic_score ?? 0,
        Math.min(result.matched_keywords.length * 5, 100),
        Math.min(result.missing_keywords.length * 5, 100),
      ],
      backgroundColor: "rgba(129, 140, 248, 0.2)",
      borderColor: "#818cf8",
      pointBackgroundColor: "#c084fc",
      borderWidth: 2,
    }],
  } : null, [result]);

  const barData = useMemo(() => result?.top_matches?.length ? {
    labels: result.top_matches.map((_, i) => `Match ${i + 1}`),
    datasets: [{
      label: "Similarity %",
      data: result.top_matches.map((m) => m.similarity),
      backgroundColor: ["#818cf8", "#c084fc", "#38bdf8", "#34d399", "#f472b6"],
      borderRadius: 8,
    }],
  } : null, [result]);

  const scoreColor = (score: number) =>
    score >= 75 ? "text-emerald-400" : score >= 50 ? "text-amber-400" : "text-red-400";

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "keywords", label: "Keywords", icon: "🔑" },
    { id: "ai", label: "AI Insights", icon: "🤖" },
    { id: "charts", label: "Charts", icon: "📈" },
    { id: "export", label: "Export", icon: "📥" },
  ];

  return (
    <div className="animated-bg min-h-screen text-white">

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white font-bold text-sm">R</div>
            <span className="text-base font-bold tracking-tight">ResumeIQ</span>
            <span className="hidden sm:inline text-xs text-slate-500 ml-1">AI Resume Optimizer</span>
          </div>
          <div className="flex items-center gap-3">
            {result && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="rounded-xl bg-slate-700/60 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors"
              >
                History ({history.length})
              </button>
            )}
            {user ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-xl bg-slate-700/60 px-3 py-1.5">
                  <div className="h-2 w-2 rounded-full bg-emerald-400 pulse-dot" />
                  <span className="text-xs text-slate-300 max-w-[120px] truncate">{user.email}</span>
                </div>
                <button
                  onClick={() => signOut()}
                  className="rounded-xl bg-slate-700/60 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 text-xs font-semibold transition-colors"
              >
                Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ─── Auth Modal ─────────────────────────────────────────────────────── */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* ─── Preview Modal ───────────────────────────────────────────────────── */}
      {previewOpen && result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="max-w-3xl w-full rounded-2xl bg-slate-800 border border-slate-700 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Report Preview</h3>
              <button onClick={() => setPreviewOpen(false)} className="text-slate-400 hover:text-white text-xl">✕</button>
            </div>
            <pre className="whitespace-pre-wrap text-sm text-slate-300 max-h-[65vh] overflow-auto leading-relaxed">
              {buildFullReportText()}
            </pre>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-8 space-y-6">

        {/* ─── Hero ─────────────────────────────────────────────────────────── */}
        {!result && (
          <div className="text-center py-6 fade-in-up">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-900/50 border border-indigo-700/50 px-4 py-1.5 text-xs font-medium text-indigo-300 mb-4">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
              Powered by local AI — your data stays private
            </div>
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-300 via-purple-300 to-pink-300 bg-clip-text text-transparent mb-3">
              Land More Interviews
            </h1>
            <p className="text-slate-400 max-w-lg mx-auto text-base">
              Match your resume against any job description. Get AI-powered keyword analysis, ATS score, and improvement tips instantly.
            </p>
          </div>
        )}

        {/* ─── Input Card ──────────────────────────────────────────────────── */}
        <div className="rounded-2xl bg-slate-800/60 border border-white/10 backdrop-blur-xl p-6 shadow-xl">
          {result && (
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-bold text-slate-200">Analyze Another Resume</h2>
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            {/* Left: Upload + Job Title */}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">Resume</label>
                <DropZone file={resume} onChange={setResume} />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-2">
                  Job Title <span className="text-slate-500 font-normal">(optional)</span>
                </label>
                <input
                  className="w-full rounded-xl bg-slate-900/80 border border-slate-600 px-4 py-2.5 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-indigo-500 transition-colors"
                  placeholder="e.g. Senior Frontend Engineer"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </div>
            </div>

            {/* Right: Job Description */}
            <div className="flex flex-col">
              <label className="block text-sm font-semibold text-slate-300 mb-2">Job Description</label>
              <textarea
                className="flex-1 min-h-[180px] rounded-xl bg-slate-900/80 border border-slate-600 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                placeholder="Paste the full job description here…"
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
              <p className="text-xs text-slate-600 mt-1.5 text-right">
                {jobDescription.split(/\s+/).filter(Boolean).length} words
              </p>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="mt-5 w-full rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:brightness-110 disabled:opacity-60 py-3 font-bold text-white shadow-lg transition-all active:scale-[0.99]"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                {loadingStep || "Analyzing…"}
              </span>
            ) : (
              "⚡ Analyze Match"
            )}
          </button>

          {!user && (
            <p className="mt-3 text-center text-xs text-slate-500">
              <button onClick={() => setShowAuth(true)} className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">
                Sign in
              </button>{" "}
              to save your results across sessions
            </p>
          )}
        </div>

        {/* ─── Results ─────────────────────────────────────────────────────── */}
        {result && (
          <div className="fade-in-up space-y-4">

            {/* Score summary bar */}
            <div className="rounded-2xl bg-slate-800/60 border border-white/10 backdrop-blur-xl p-5 shadow-xl">
              <div className="flex flex-wrap items-center gap-6">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">ATS Match Score</p>
                  <p className={`text-4xl font-extrabold ${scoreColor(result.match_score)}`}>
                    {result.match_score}%
                  </p>
                </div>
                <div className="h-10 w-px bg-slate-700" />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Semantic Score</p>
                  <p className={`text-4xl font-extrabold ${scoreColor(result.semantic_score ?? 0)}`}>
                    {result.semantic_score ?? 0}%
                  </p>
                </div>
                <div className="h-10 w-px bg-slate-700" />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Matched Keywords</p>
                  <p className="text-4xl font-extrabold text-emerald-400">{result.matched_keywords.length}</p>
                </div>
                <div className="h-10 w-px bg-slate-700" />
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Missing Keywords</p>
                  <p className="text-4xl font-extrabold text-red-400">{result.missing_keywords.length}</p>
                </div>
                {jobTitle && (
                  <>
                    <div className="h-10 w-px bg-slate-700" />
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">Job Title</p>
                      <p className="text-base font-semibold text-slate-200">{jobTitle}</p>
                    </div>
                  </>
                )}
              </div>

              {/* Score bar */}
              <div className="mt-4 h-2 w-full rounded-full bg-slate-700">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000"
                  style={{ width: `${result.match_score}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-1.5">
                {result.match_score >= 75
                  ? "Great match! Your resume aligns well with this role."
                  : result.match_score >= 50
                    ? "Fair match. Adding missing keywords could improve your chances."
                    : "Low match. Focus on the missing keywords and AI suggestions below."}
              </p>
            </div>

            {/* Tabs */}
            <div className="rounded-2xl bg-slate-800/60 border border-white/10 backdrop-blur-xl shadow-xl overflow-hidden">
              <div className="flex gap-1 border-b border-white/10 px-4 overflow-x-auto">
                {tabs.map((t) => (
                  <TabBtn
                    key={t.id} id={t.id} label={t.label} icon={t.icon}
                    active={activeTab === t.id}
                    onClick={() => setActiveTab(t.id)}
                  />
                ))}
              </div>

              <div className="p-6">

                {/* ── Overview Tab ── */}
                {activeTab === "overview" && (
                  <div className="space-y-6 fade-in-up">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <ScoreRing value={result.match_score} label="Match Score" color="indigo" />
                      <ScoreRing value={result.semantic_score ?? 0} label="Semantic Score" color="purple" />
                      <div className="flex flex-col items-center justify-center gap-2">
                        <div className="text-center">
                          <p className="text-3xl font-extrabold text-slate-200">
                            {result.matched_keywords.length}/{result.matched_keywords.length + result.missing_keywords.length}
                          </p>
                          <p className="text-xs text-slate-500 uppercase tracking-wider mt-1">Keywords Matched</p>
                        </div>
                        <div className="w-full h-2 rounded-full bg-slate-700 mt-2">
                          <div
                            className="h-2 rounded-full bg-emerald-500"
                            style={{
                              width: `${(result.matched_keywords.length / (result.matched_keywords.length + result.missing_keywords.length)) * 100}%`
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Highlighted JD */}
                    <div>
                      <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                        Job Description — missing keywords highlighted in red
                      </h3>
                      <div className="rounded-xl bg-slate-900/60 border border-slate-700 p-4 max-h-64 overflow-y-auto text-sm">
                        {highlightedJD}
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Keywords Tab ── */}
                {activeTab === "keywords" && (
                  <div className="space-y-5 fade-in-up">
                    <div>
                      <h3 className="text-sm font-semibold text-emerald-400 mb-3 flex items-center gap-2">
                        ✅ Matched Keywords ({result.matched_keywords.length})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {result.matched_keywords.map((kw) => (
                          <Pill key={kw} text={kw} variant="green" />
                        ))}
                      </div>
                    </div>
                    <div className="h-px bg-slate-700" />
                    <div>
                      <h3 className="text-sm font-semibold text-red-400 mb-3 flex items-center gap-2">
                        ❌ Missing Keywords ({result.missing_keywords.length})
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {result.missing_keywords.map((kw) => (
                          <Pill key={kw} text={kw} variant="red" />
                        ))}
                      </div>
                      {result.missing_keywords.length > 0 && (
                        <p className="mt-3 text-xs text-slate-500">
                          💡 Try to naturally incorporate these keywords into your resume to improve your match score.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* ── AI Insights Tab ── */}
                {activeTab === "ai" && (
                  <div className="space-y-5 fade-in-up">
                    {result.ai_summary && (
                      <div className="rounded-xl bg-indigo-900/30 border border-indigo-700/40 p-4">
                        <h3 className="text-sm font-semibold text-indigo-300 mb-2">🤖 AI Summary</h3>
                        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{result.ai_summary}</p>
                      </div>
                    )}

                    {result.ai_missing_skills && result.ai_missing_skills.length > 0 && (
                      <div className="rounded-xl bg-amber-900/30 border border-amber-700/40 p-4">
                        <h3 className="text-sm font-semibold text-amber-300 mb-3">🎯 Skills to Develop</h3>
                        <ul className="space-y-2">
                          {result.ai_missing_skills.map((s, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-amber-200/80">
                              <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-amber-500/20 text-amber-400 text-xs flex items-center justify-center">{i + 1}</span>
                              {s}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {result.ai_bullet_improvements && result.ai_bullet_improvements.length > 0 && (
                      <div className="rounded-xl bg-purple-900/30 border border-purple-700/40 p-4">
                        <h3 className="text-sm font-semibold text-purple-300 mb-3">✨ Bullet Point Improvements</h3>
                        <ul className="space-y-3">
                          {result.ai_bullet_improvements.map((b, i) => (
                            <li key={i} className="text-sm text-purple-200/80 leading-relaxed border-l-2 border-purple-600/50 pl-3">
                              {b}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!result.ai_summary && !result.ai_missing_skills?.length && !result.ai_bullet_improvements?.length && (
                      <p className="text-slate-500 text-sm">No AI insights available for this analysis.</p>
                    )}
                  </div>
                )}

                {/* ── Charts Tab ── */}
                {activeTab === "charts" && (
                  <div className="space-y-6 fade-in-up">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="rounded-xl bg-slate-900/50 border border-slate-700 p-4">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Keyword Coverage</h3>
                        <div className="max-w-[220px] mx-auto">
                          {doughnutData && <Doughnut data={doughnutData} options={{ plugins: { legend: { labels: { color: "#94a3b8" } } } }} />}
                        </div>
                      </div>
                      <div className="rounded-xl bg-slate-900/50 border border-slate-700 p-4">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Skill Radar</h3>
                        {radarData && (
                          <Radar data={radarData} options={{
                            scales: {
                              r: {
                                ticks: { color: "#475569", backdropColor: "transparent" },
                                grid: { color: "#1e293b" },
                                pointLabels: { color: "#94a3b8", font: { size: 11 } },
                              }
                            },
                            plugins: { legend: { display: false } }
                          }} />
                        )}
                      </div>
                    </div>
                    {barData && (
                      <div className="rounded-xl bg-slate-900/50 border border-slate-700 p-4">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Top Semantic Matches</h3>
                        <Bar data={barData} options={{
                          plugins: { legend: { display: false } },
                          scales: {
                            y: { ticks: { color: "#94a3b8" }, grid: { color: "#1e293b" } },
                            x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
                          },
                        }} />
                      </div>
                    )}
                  </div>
                )}

                {/* ── Export Tab ── */}
                {activeTab === "export" && (
                  <div className="space-y-5 fade-in-up">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {[
                        { label: "Download PDF", desc: "Formatted report as PDF", onClick: downloadPdf, color: "bg-indigo-600 hover:bg-indigo-500" },
                        { label: "Download DOCX", desc: "Word document format", onClick: downloadDocx, color: "bg-purple-600 hover:bg-purple-500" },
                        { label: "Download TXT", desc: "Plain text report", onClick: downloadTxt, color: "bg-slate-600 hover:bg-slate-500" },
                        { label: "Download JSON", desc: "Raw data for developers", onClick: downloadJson, color: "bg-slate-700 hover:bg-slate-600" },
                      ].map((btn) => (
                        <button
                          key={btn.label}
                          onClick={btn.onClick}
                          className={`rounded-xl ${btn.color} p-4 text-left transition-colors`}
                        >
                          <p className="font-semibold text-sm">{btn.label}</p>
                          <p className="text-xs text-white/60 mt-0.5">{btn.desc}</p>
                        </button>
                      ))}
                    </div>
                    <div className="h-px bg-slate-700" />
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => setPreviewOpen(true)}
                        className="rounded-xl bg-slate-700 hover:bg-slate-600 px-4 py-2.5 text-sm font-medium transition-colors"
                      >
                        👁 Preview Report
                      </button>
                      <button
                        onClick={copyShareLink}
                        className="rounded-xl bg-slate-700 hover:bg-slate-600 px-4 py-2.5 text-sm font-medium transition-colors"
                      >
                        🔗 Copy Share Link
                      </button>
                      <button
                        onClick={() => copyToClipboard(buildFullReportText())}
                        className="rounded-xl bg-slate-700 hover:bg-slate-600 px-4 py-2.5 text-sm font-medium transition-colors"
                      >
                        📋 Copy Report Text
                      </button>
                      {copyMessage && (
                        <span className="self-center text-sm text-emerald-400">{copyMessage}</span>
                      )}
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        )}

        {/* ─── History Panel ───────────────────────────────────────────────── */}
        {showHistory && history.length > 0 && (
          <div className="rounded-2xl bg-slate-800/60 border border-white/10 backdrop-blur-xl p-6 shadow-xl fade-in-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-200">Recent Sessions</h2>
              <div className="flex gap-2">
                <button
                  onClick={() => { setHistory([]); localStorage.removeItem("resume_history"); }}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  Clear All
                </button>
                <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>
            </div>
            <div className="space-y-2">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl bg-slate-900/50 border border-slate-700 p-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 mb-0.5">{item.timestamp}</p>
                    <p className="text-sm font-medium text-slate-200 truncate">
                      {item.jobTitle || item.jobDescription.slice(0, 60) + "…"}
                    </p>
                    <div className="flex gap-3 mt-1">
                      <span className={`text-xs font-semibold ${scoreColor(item.result.match_score)}`}>
                        Match: {item.result.match_score}%
                      </span>
                      <span className={`text-xs font-semibold ${scoreColor(item.result.semantic_score ?? 0)}`}>
                        Semantic: {item.result.semantic_score ?? 0}%
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => { setResult(item.result); setJobDescription(item.jobDescription); setJobTitle(item.jobTitle ?? ""); setShowHistory(false); }}
                      className="rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-600/30 px-3 py-1.5 text-xs font-medium text-indigo-300 transition-colors"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => {
                        const updated = history.filter((h) => h.id !== item.id);
                        setHistory(updated);
                        localStorage.setItem("resume_history", JSON.stringify(updated));
                      }}
                      className="rounded-lg bg-red-900/20 hover:bg-red-900/40 border border-red-700/30 px-2 py-1.5 text-xs text-red-400 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* ─── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="text-center py-8 text-xs text-slate-600">
        ResumeIQ · Powered by local AI · Your data never leaves your machine
      </footer>

    </div>
  );
}
