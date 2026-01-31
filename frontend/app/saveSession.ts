import { supabase } from "../lib/supabaseClient";
import type { AnalyzeResult } from "./types";

export async function saveSession(jobDescription: string, result: AnalyzeResult) {
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