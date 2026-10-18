import { z } from "zod";
import { ApiError, json, parseBody, route } from "../../../lib/http.ts";
import { intakeStage } from "../../../lib/agent/intake-stage.ts";
import { createRateLimiter } from "../../../lib/rate-limit.ts";
import { requireSessionAndCsrf, sessionId } from "../../../lib/session.ts";

const IntakeBody = z.strictObject({ goal: z.string().trim().min(3).max(300) });
const limiter = createRateLimiter({ max: 20, windowMs: 60 * 60 * 1000 });

export const POST = route(async (request: Request) => {
  requireSessionAndCsrf(request);
  const { goal } = await parseBody(request, IntakeBody);
  if (!limiter.allow(sessionId(request))) {
    throw new ApiError(429, "RATE_LIMITED", "You've reached the hourly goal limit. Please try again later.");
  }
  return json(await intakeStage(goal));
});
