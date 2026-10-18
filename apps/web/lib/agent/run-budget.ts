import type { RunLimits } from "../env.ts";

type Usage = { totalTokens?: number | undefined; inputTokens?: number | undefined; outputTokens?: number | undefined };
export const usageTokens = (usage: Usage | undefined) =>
  usage ? usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : 0;

// SPEC §7.4 step 8: MAX_STEPS planner model steps and RUN_TOKEN_BUDGET tokens per run. Crossing a
// limit aborts the run's controller, so every in-flight model and store call stops. Each step is
// logged without any contract or page text.
export class RunBudget {
  steps = 0;
  tokens = 0;
  exceeded: "steps" | "tokens" | null = null;

  constructor(
    readonly limits: RunLimits,
    private readonly controller: AbortController,
    private readonly log: (line: string) => void,
    private readonly runId: string,
  ) {}

  stepsLeft(): number {
    return this.limits.MAX_STEPS - this.steps;
  }

  // `summary` names tools and error classes only, never model or store text.
  addPlannerStep(usage: Usage | undefined, summary = ""): void {
    this.steps += 1;
    this.tokens += usageTokens(usage);
    this.log(`shop ${this.runId} planner step ${this.steps}/${this.limits.MAX_STEPS} tokens ${this.tokens}/${this.limits.RUN_TOKEN_BUDGET}${summary ? ` ${summary}` : ""}`);
    if (this.steps > this.limits.MAX_STEPS) this.stop("steps");
    this.check();
  }

  addReaderTokens(sku: string, tokens: number): void {
    this.tokens += tokens;
    this.log(`shop ${this.runId} reader ${sku} tokens ${this.tokens}/${this.limits.RUN_TOKEN_BUDGET}`);
    this.check();
  }

  private check(): void {
    if (this.tokens > this.limits.RUN_TOKEN_BUDGET) this.stop("tokens");
  }

  private stop(reason: "steps" | "tokens"): void {
    this.exceeded ??= reason;
    this.controller.abort();
  }
}
