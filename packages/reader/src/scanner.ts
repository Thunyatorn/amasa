// SPEC §8.1, copied from the SPEC (scanner.test.ts compares every pattern with it). The zero-width
// character class is written with \u escapes instead of the invisible characters themselves.
export const INJECTION_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b.{0,40}\b(previous|prior|above|earlier|all|your|these|the|user'?s)\b.{0,20}\b(instructions?|rules?|prompts?|constraints?|contract|budget|limits?)\b/i,
  /\b(system|developer)\s*(prompt|message|instructions?)\b/i,
  /\b(you are|act as|as an ai|ai (agent|assistant|shopper|model)|language model|llm)\b/i,
  /\b(agents?|assistants?|bots?)\b.{0,30}\b(must|should|always|need to)\b/i,
  /\b(must|should|always)\s+(buy|purchase|order|add|choose|select|pick|recommend)\b/i,
  /\b(add|put)\b.{0,30}\b(to (the |your )?cart|another item|second item)\b/i,
  /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|ru|top|info)\b/i,
  /<[^>]+>|&lt;|&#\d+;/,
  /[\u200b-\u200d\u2060\ufeff]/,
  /[A-Za-z0-9+/]{60,}={0,2}/,
];

export const scan = (text: string) => INJECTION_PATTERNS.filter((p) => p.test(text)).map(String);
