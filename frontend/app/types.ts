export type AnalyzeResult = {
  match_score: number;
  matched_keywords: string[];
  missing_keywords: string[];
  semantic_score?: number;
};