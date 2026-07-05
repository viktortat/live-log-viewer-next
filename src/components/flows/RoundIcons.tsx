"use client";

import { Check, Diamond, Hourglass, TriangleAlert, X } from "lucide-react";

import type { ReviewVerdict } from "@/lib/flows/types";

/**
 * Icon language of a review round, shared by the strip chips, the deck
 * spines and the scheme mini-decks: verdicts map to Lucide icons (the text
 * glyphs in VERDICT_GLYPHS stay for plain-string contexts like titles).
 */
export function RoundStateIcon({
  verdict,
  error,
  className = "h-3 w-3",
}: {
  verdict: ReviewVerdict | null;
  error: boolean;
  className?: string;
}) {
  if (verdict === "APPROVE") return <Check className={className} strokeWidth={3} aria-hidden />;
  if (verdict === "REQUEST_CHANGES") return <X className={className} strokeWidth={3} aria-hidden />;
  if (verdict === "COMMENT") return <Diamond className={className} strokeWidth={2.5} aria-hidden />;
  if (error) return <TriangleAlert className={className} aria-hidden />;
  return <Hourglass className={className} aria-hidden />;
}
