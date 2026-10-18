import { randomUUID } from "node:crypto";
import type { ContractDraft, Rule } from "@amasa/schemas";
import { getDb, type Db } from "../db/index.ts";
import { insertDraft } from "../db/drafts.ts";
import { confirmedProfile } from "../db/profile.ts";
import { ApiError } from "../http.ts";
import { modelFromEnv, runIntake, type IntakeModel, type LanguageModel } from "./intake.ts";

function configuredModel(): IntakeModel {
  try {
    return modelFromEnv();
  } catch (error) {
    // The message names the missing variables, never their values.
    console.error(error instanceof Error ? error.message : "model configuration error");
    throw new ApiError(503, "MODEL_NOT_CONFIGURED", "Amasa can't read goals right now. Please try again later.");
  }
}

export async function intakeStage(goal: string, deps: {
  model?: LanguageModel; db?: Db; now?: () => Date;
} = {}): Promise<{ draftId: string; draft: ContractDraft; unsupported: Rule[] }> {
  const db = deps.db ?? getDb();
  const now = (deps.now ?? (() => new Date()))();
  const intakeModel = deps.model ? { model: deps.model } : configuredModel();
  const { draft, unsupported } = await runIntake(
    { goal, profile: confirmedProfile(db), today: now.toISOString().slice(0, 10) }, intakeModel);
  const draftId = randomUUID();
  insertDraft(db, draftId, draft, now.toISOString(), unsupported);
  return { draftId, draft, unsupported };
}
