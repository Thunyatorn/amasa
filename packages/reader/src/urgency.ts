// SPEC §8.3: whole sentences with urgency or scarcity wording are removed from planner reasons.
// Curly apostrophes are accepted too, so "don’t miss" cannot slip past the straight-quote form.
const URGENCY = /\b(hurry|limited time|act now|only \d+ left|selling fast|don['’]t miss|last chance|today only|before it['’]s gone)\b/i;
export const URGENCY_FALLBACK = "Matches your contract";

export function stripUrgency(text: string): string {
  const kept = text.split(/(?<=[.!?])\s+/).filter((sentence) => !URGENCY.test(sentence));
  const result = kept.join(" ").trim();
  return result || URGENCY_FALLBACK;
}
