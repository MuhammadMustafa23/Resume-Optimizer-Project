import { supabase } from "../lib/supabaseClient";

export async function getHistory() {
  const { data, error } = await supabase
    .from("resume_sessions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}