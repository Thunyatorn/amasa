import type { z } from "zod";

// Typed errors: every failure response is { code, message } (CLAUDE.md, SPEC §5).
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers });

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "INVALID_REQUEST", "The request is missing fields or has invalid values.");
  return parsed.data;
}

// Wraps a route handler: ApiError becomes its typed response; anything else is a 500 without
// internal details (logged server-side, message trimmed).
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return json({ code: e.code, message: e.message }, e.status);
      console.error(`internal error: ${e instanceof Error ? e.message.slice(0, 300) : "unknown"}`);
      return json({ code: "INTERNAL", message: "Something went wrong. Please try again." }, 500);
    }
  };
}
