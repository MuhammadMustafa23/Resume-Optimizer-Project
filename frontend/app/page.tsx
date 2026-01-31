"use client";

import { useEffect, useMemo, useState } from "react";
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
  ArcElement,
  RadialLinearScale,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  PointElement,
  LineElement
);

type AnalyzeResult = {
  match_score: number;
  semantic_score?: number;
  top_matches?: {
    job_sentence: string;
    resume_sentence: string;
    similarity: number;
  }[];
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
  jobDescription: string;
  result: AnalyzeResult;
};

export const signUp = async (email: string, password: string) =>
  supabase.auth.signUp({ email, password });

export const signIn = async (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const signOut = async () => supabase.auth.signOut();

async function saveSession(jobDescription: string, result: AnalyzeResult) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) throw userError;
  if (!user) throw new Error("Not logged in");

  const { error } = await supabase.from("resume_sessions").insert([
    {
      user_id: user.id,
      job_title: jobDescription.slice(0, 120),
      score: result.match_score,
      skills: {
        matched_keywords: result.matched_keywords,
        missing_keywords: result.missing_keywords,
        semantic_score: result.semantic_score ?? 0,
      },
    },
  ]);

  if (error) throw error;
}

function ScoreRing({ value, label }: { value: number; label: string }) {
  const radius = 46;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" className="drop-shadow-lg">
        <defs>
          <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="50%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="#e5e7eb"
          strokeWidth="10"
          fill="transparent"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke="url(#ringGradient)"
          strokeWidth="10"
          fill="transparent"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset}
          transform="rotate(-90 60 60)"
        />
        <text
          x="60"
          y="66"
          textAnchor="middle"
          fontSize="20"
          fill="#111827"
          fontWeight="700"
        >
          {progress}%
        </text>
      </svg>
      <span className="text-xs font-semibold text-slate-700">{label}</span>
    </div>
  );
}

export default function Home() {
  const [resume, setResume] = useState<File | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<any>(null);

  const [authMessage, setAuthMessage] = useState("");
const [authLoading, setAuthLoading] = useState(false);

const handleSignIn = async () => {
  setAuthLoading(true);
  setAuthMessage("");
  const { error } = await signIn(email, password);
  setAuthLoading(false);
  setAuthMessage(error ? `Sign in failed: ${error.message}` : "Signed in ✅");
};

const handleSignUp = async () => {
  setAuthLoading(true);
  setAuthMessage("");
  const { error } = await signUp(email, password);
  setAuthLoading(false);
  setAuthMessage(
    error ? `Sign up failed: ${error.message}` : "Sign up success ✅ (check email if confirmation is on)"
  );
};
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
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
      } catch {
        console.warn("Invalid shared report link.");
      }
    }
  }, []);

  const saveHistory = (item: HistoryItem) => {
    const updated = [item, ...history].slice(0, 5);
    setHistory(updated);
    localStorage.setItem("resume_history", JSON.stringify(updated));
  };

  const removeHistoryItem = (id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    localStorage.setItem("resume_history", JSON.stringify(updated));
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem("resume_history");
  };

  const handleAnalyze = async () => {
    setError("");

    if (!user) {
      setError("Please sign in first to save your session.");
      return;
    }

    if (!resume || !jobDescription.trim()) {
      setError("Please upload a resume and paste a job description.");
      return;
    }

    if (resume.size > 5 * 1024 * 1024) {
      setError("Resume file is too large. Max 5MB allowed.");
      return;
    }

    const formData = new FormData();
    formData.append("resume", resume);
    formData.append("job_description", jobDescription);

    setLoading(true);
    setResult(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      setResult(data);

      await saveSession(jobDescription, data);

      saveHistory({
        id: String(Date.now()),
        timestamp: new Date().toLocaleString(),
        jobDescription,
        result: data,
      });
    } catch (err) {
      console.error(err);
      setError("Failed to analyze. Check backend logs.");
    } finally {
      setLoading(false);
    }
  };

  const buildFullReportText = () => {
    if (!result) return "";
    return [
      "Resume Analysis Report",
      "",
      `Filename: ${result.filename}`,
      `Match Score: ${result.match_score}%`,
      `Semantic Score: ${result.semantic_score ?? "—"}%`,
      "",
      `Matched Keywords: ${result.matched_keywords.join(", ")}`,
      "",
      `Missing Keywords: ${result.missing_keywords.join(", ")}`,
      "",
      "AI Structured Summary:",
      result.ai_summary ?? "",
      "",
      "AI Missing Skills:",
      (result.ai_missing_skills ?? []).join(", "),
      "",
      "AI Bullet Improvements:",
      ...(result.ai_bullet_improvements ?? []),
      "",
      "Job Description:",
      jobDescription,
    ].join("\n");
  };

  const downloadJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-analysis.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = () => {
    if (!result) return;
    const doc = new jsPDF();
    const lines = buildFullReportText();
    const wrapped = doc.splitTextToSize(lines, 180);
    doc.text(wrapped, 10, 10);
    doc.save("resume-analysis.pdf");
  };

  const downloadFullReportTxt = () => {
    if (!result) return;
    const blob = new Blob([buildFullReportText()], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-analysis.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadDocx = async () => {
    if (!result) return;
    const lines = buildFullReportText().split("\n");
    const doc = new Document({
      sections: [
        {
          children: lines.map(
            (line) =>
              new Paragraph({
                children: [new TextRun(line)],
              })
          ),
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "resume-analysis.docx";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Copied ✅");
      setTimeout(() => setCopyMessage(""), 1500);
    } catch {
      setCopyMessage("Copy failed ❌");
      setTimeout(() => setCopyMessage(""), 1500);
    }
  };

  const copyShareLink = () => {
    if (!result) return;
    const payload = { result, jobDescription };
    const encoded = encodeURIComponent(btoa(JSON.stringify(payload)));
    const url = `${window.location.origin}${window.location.pathname}?report=${encoded}`;
    copyToClipboard(url);
  };

  const highlightedJD = useMemo(() => {
    if (!result?.missing_keywords?.length) return jobDescription;

    const missingSet = new Set(result.missing_keywords.map((k) => k.toLowerCase()));

    return jobDescription.split(/\b/).map((word, i) => {
      const clean = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (missingSet.has(clean)) {
        return (
          <mark
            key={`${word}-${i}`}
            className="rounded bg-pink-200/80 px-1 text-pink-900"
          >
            {word}
          </mark>
        );
      }
      return <span key={`${word}-${i}`}>{word}</span>;
    });
  }, [jobDescription, result]);

  const doughnutData = useMemo(() => {
    if (!result) return null;
    return {
      labels: ["Matched", "Missing"],
      datasets: [
        {
          data: [result.matched_keywords.length, result.missing_keywords.length],
          backgroundColor: ["#10b981", "#f43f5e"],
          borderWidth: 0,
          hoverOffset: 8,
        },
      ],
    };
  }, [result]);

  const radarData = useMemo(() => {
    if (!result) return null;
    return {
      labels: ["Match", "Semantic", "Matched", "Missing"],
      datasets: [
        {
          label: "Signal",
          data: [
            result.match_score,
            result.semantic_score ?? 0,
            Math.min(result.matched_keywords.length * 5, 100),
            Math.min(result.missing_keywords.length * 5, 100),
          ],
          backgroundColor: "rgba(139, 92, 246, 0.3)",
          borderColor: "#8b5cf6",
          pointBackgroundColor: "#ec4899",
          borderWidth: 2,
        },
      ],
    };
  }, [result]);

  const barData = useMemo(() => {
    if (!result?.top_matches?.length) return null;
    return {
      labels: result.top_matches.map((_, i) => `Match ${i + 1}`),
      datasets: [
        {
          label: "Similarity",
          data: result.top_matches.map((m) => m.similarity),
          backgroundColor: ["#38bdf8", "#8b5cf6", "#f472b6", "#22c55e", "#f97316"],
          borderRadius: 12,
        },
      ],
    };
  }, [result]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-gradient-to-br from-fuchsia-600 via-indigo-600 to-sky-500 p-6">
      <div className="pointer-events-none absolute -top-24 -left-24 h-80 w-80 rounded-full bg-pink-400/50 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute top-40 -right-24 h-96 w-96 rounded-full bg-blue-400/40 blur-3xl animate-pulse" />
      <div className="pointer-events-none absolute bottom-10 left-20 h-72 w-72 rounded-full bg-purple-400/40 blur-3xl animate-pulse" />

      <div className="relative mx-auto max-w-5xl space-y-8">
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl p-6 shadow-2xl border border-white/40">
          <h2 className="text-xl font-bold text-slate-900 mb-3">Sign In / Sign Up</h2>

          <div className="grid gap-3">
           <input
  className="w-full rounded-xl border border-slate-300 p-3 bg-white text-slate-900 placeholder:text-slate-400"
  placeholder="Email"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>
<input
  className="w-full rounded-xl border border-slate-300 p-3 bg-white text-slate-900 placeholder:text-slate-400"
  placeholder="Password"
  type="password"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
/>
            <div className="flex gap-3 flex-wrap">
  <button
    onClick={handleSignIn}
    disabled={authLoading}
    className="rounded-xl bg-indigo-600 px-4 py-2 text-black font-semibold disabled:opacity-60"
  >
    {authLoading ? "Please wait..." : "Sign In"}
  </button>
  <button
    onClick={handleSignUp}
    disabled={authLoading}
    className="rounded-xl bg-emerald-600 px-4 py-2 text-black font-semibold disabled:opacity-60"
  >
    {authLoading ? "Please wait..." : "Sign Up"}
  </button>
  {user && (
    <button
      onClick={signOut}
      className="rounded-xl bg-slate-700 px-4 py-2 text-white font-semibold"
    >
      Sign Out
    </button>
  )}
</div>

{authMessage && (
  <p className="text-sm text-slate-700 bg-slate-100 rounded-xl px-3 py-2">
    {authMessage}
  </p>
)}
            {user && (
              <p className="text-xs text-slate-600">
                Signed in as: <span className="font-semibold">{user.email}</span>
              </p>
            )}
          </div>
        </div>

        {/* Input Card */}
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl p-8 shadow-2xl border border-white/40">
          <div className="flex flex-col gap-2">
            <span className="inline-flex w-fit items-center rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
              AI Resume Toolkit
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900">
              Resume Optimizer
            </h1>
            <p className="text-slate-700 max-w-2xl">
              Upload your resume and paste the job description to get a match score,
              keyword gaps, and improvement tips.
            </p>
          </div>

          <div className="mt-8 grid gap-6">
            <div>
              <label className="block font-semibold mb-2 text-slate-800">
                Upload Resume (PDF/DOCX)
              </label>
              <div className="rounded-2xl border-2 border-dashed border-indigo-300 bg-indigo-50/60 p-5 text-center hover:border-indigo-400 transition">
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="block w-full text-sm text-slate-700 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700"
                  onChange={(e) => setResume(e.target.files?.[0] || null)}
                />
                {resume && (
                  <p className="mt-2 text-sm text-slate-600">
                    Selected: <span className="font-medium">{resume.name}</span>
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="block font-semibold mb-2 text-slate-800">
                Job Description
              </label>
              <textarea
                className="w-full rounded-2xl border border-indigo-200 bg-white/90 p-4 h-44 text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-200 outline-none"
                placeholder="Paste the job description here..."
                value={jobDescription}
                onChange={(e) => setJobDescription(e.target.value)}
              />
              <p className="text-xs text-slate-600 mt-1">
                {jobDescription.split(/\s+/).filter(Boolean).length} words
              </p>
            </div>

            {error && (
              <div className="rounded-2xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              onClick={handleAnalyze}
              className="w-full rounded-2xl bg-gradient-to-r from-pink-500 via-fuchsia-500 to-indigo-500 py-3 font-bold text-white shadow-lg hover:brightness-110 transition"
            >
              {loading ? "Analyzing..." : "Analyze Match"}
            </button>
          </div>
        </div>

        {/* Dashboard */}
        {result && (
          <div className="rounded-3xl bg-white/90 backdrop-blur-xl p-8 shadow-2xl border border-white/40">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">
              Nebula Insight Dashboard
            </h2>

            <div className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-2xl bg-white p-4 border border-slate-200">
                <ScoreRing value={result.match_score} label="Match Score" />
              </div>
              <div className="rounded-2xl bg-white p-4 border border-slate-200">
                <ScoreRing value={result.semantic_score ?? 0} label="Semantic Score" />
              </div>
              <div className="rounded-2xl bg-white p-4 border border-slate-200">
                {doughnutData && <Doughnut data={doughnutData} />}
              </div>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-2xl bg-white p-4 border border-slate-200">
                {radarData && <Radar data={radarData} />}
              </div>
              <div className="rounded-2xl bg-white p-4 border border-slate-200">
                {barData && <Bar data={barData} />}
              </div>
            </div>
          </div>
        )}

        {/* Report Actions */}
        {result && (
          <div className="rounded-3xl bg-white/90 backdrop-blur-xl p-6 shadow-2xl border border-white/40">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Report Actions</h2>
            <div className="flex flex-wrap gap-3">
              <button onClick={downloadJson} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Download JSON
              </button>
              <button onClick={downloadPdf} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">
                Download PDF
              </button>
              <button onClick={downloadFullReportTxt} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">
                Download TXT
              </button>
              <button onClick={downloadDocx} className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white">
                Download DOCX
              </button>
              <button onClick={() => setPreviewOpen(true)} className="rounded-xl bg-slate-700 px-4 py-2 text-sm font-semibold text-white">
                Preview Report
              </button>
              <button onClick={copyShareLink} className="rounded-xl bg-indigo-800 px-4 py-2 text-sm font-semibold text-white">
                Copy Share Link
              </button>
              {result.ai_summary && (
                <button onClick={() => copyToClipboard(result.ai_summary || "")} className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white">
                  Copy AI Summary
                </button>
              )}
              <button onClick={() => copyToClipboard(buildFullReportText())} className="rounded-xl bg-slate-600 px-4 py-2 text-sm font-semibold text-white">
                Copy Full Report
              </button>
              {copyMessage && <span className="text-sm text-slate-700">{copyMessage}</span>}
            </div>
          </div>
        )}

        {/* Preview Modal */}
        {previewOpen && result && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-w-3xl w-full rounded-3xl bg-white p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-slate-900">Report Preview</h3>
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="rounded-xl bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  Close
                </button>
              </div>
              <pre className="whitespace-pre-wrap text-sm text-slate-700 max-h-[60vh] overflow-auto">
                {buildFullReportText()}
              </pre>
            </div>
          </div>
        )}

        {/* Highlighted Job Description */}
        {result && (
          <div className="rounded-3xl bg-white/90 backdrop-blur-xl p-8 shadow-2xl border border-white/40">
            <h2 className="text-2xl font-bold text-slate-900 mb-4">
              Job Description (Missing Keywords Highlighted)
            </h2>
            <div className="text-slate-700 leading-relaxed">
              {highlightedJD}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}