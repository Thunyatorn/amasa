import { generateText, Output, type LanguageModel } from "ai";
import { ProductPage, ReaderFacts } from "@amasa/schemas";
import { READER_SYSTEM_PROMPT } from "./prompt.ts";

// The model to call and how (structurally the same as the web app's IntakeModel).
export type ReaderModel = {
  model: LanguageModel;
  timeoutMs?: number;
  providerOptions?: Parameters<typeof generateText>[0]["providerOptions"];
};

export type ReadResult =
  | { ok: true; facts: ReaderFacts; tokens: number }
  | { ok: false; tokens: number; error: string };

const unique = <T>(values: T[]) => [...new Set(values)];

// SPEC §7.3: one call per product page, no tools. The page is untrusted merchant text and goes only
// inside the delimiters. The reader's output only ranks and explains; it never decides a must-have
// or a price (SPEC §7.4). Aborting through `signal` rethrows so the run can stop; any other failure
// is a typed result and the caller excludes the product.
export async function readPage(page: ProductPage, deps: ReaderModel & { signal?: AbortSignal }): Promise<ReadResult> {
  const input = ProductPage.parse(page);
  deps.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(deps.timeoutMs ?? 30_000);
  try {
    const result = await generateText({
      model: deps.model,
      instructions: READER_SYSTEM_PROMPT,
      prompt: `<untrusted_page>${JSON.stringify(input)}</untrusted_page>`,
      output: Output.object({ schema: ReaderFacts }),
      temperature: 0,
      maxOutputTokens: 400,
      maxRetries: 1,
      abortSignal: deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout,
      ...(deps.providerOptions ? { providerOptions: deps.providerOptions } : {}),
    });
    deps.signal?.throwIfAborted();
    const usage = result.totalUsage;
    const tokens = usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    const out = result.output;
    // A topic listed as both praise and complaint is unclear, so it is dropped from both.
    const mixed = new Set(out.praise.filter((topic) => out.complaints.includes(topic)));
    const facts = ReaderFacts.parse({
      ...out, sku: input.sku, fitNotes: unique(out.fitNotes), praise: unique(out.praise.filter((t) => !mixed.has(t))),
      complaints: unique(out.complaints.filter((t) => !mixed.has(t))), suspiciousSpans: unique(out.suspiciousSpans),
    });
    return { ok: true, facts, tokens };
  } catch (error) {
    if (deps.signal?.aborted) throw error;
    return { ok: false, tokens: 0, error: error instanceof Error ? error.name : "unknown error" };
  }
}
