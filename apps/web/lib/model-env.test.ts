import { afterEach, describe, expect, it, vi } from "vitest";

const config = { MODEL_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-only", MODEL_PLANNER: "test-model" };
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("model configuration", () => {
  it("is independent of general server configuration, lazy and cached", async () => {
    vi.resetModules();
    vi.stubEnv("MODEL_PROVIDER", "");
    const { modelEnv } = await import("./env.ts");
    for (const [name, value] of Object.entries(config)) vi.stubEnv(name, value);
    expect(modelEnv()).toEqual(config);
    vi.stubEnv("MODEL_PLANNER", "changed-model");
    expect(modelEnv()).toEqual(config);
  });

  it.each(["MODEL_PROVIDER", "ANTHROPIC_API_KEY", "MODEL_PLANNER"])("names invalid %s without exposing values", async (variable) => {
    vi.resetModules();
    for (const [name, value] of Object.entries(config)) vi.stubEnv(name, value);
    vi.stubEnv(variable, variable === "MODEL_PROVIDER" ? "secret-invalid-provider" : " ");
    const { modelEnv } = await import("./env.ts");
    let message = "";
    try { modelEnv(); } catch (error) { message = (error as Error).message; }
    expect(message).toContain(variable);
    expect(message).not.toContain("secret-invalid-provider");
    expect(message).not.toContain(config.ANTHROPIC_API_KEY);
  });
});

describe("local model through Ollama", () => {
  it("needs no API key and defaults to Ollama on this machine", async () => {
    vi.resetModules();
    vi.stubEnv("MODEL_PROVIDER", "ollama"); vi.stubEnv("MODEL_PLANNER", "gemma4:latest");
    vi.stubEnv("ANTHROPIC_API_KEY", ""); vi.stubEnv("OLLAMA_BASE_URL", "");
    const { modelEnv } = await import("./env.ts");
    expect(modelEnv()).toEqual({ MODEL_PROVIDER: "ollama", OLLAMA_BASE_URL: "http://127.0.0.1:11434/v1", MODEL_PLANNER: "gemma4:latest" });
  });

  it.each([["OLLAMA_BASE_URL", "not a url"], ["MODEL_PLANNER", " "]])("names invalid %s", async (variable, value) => {
    vi.resetModules();
    vi.stubEnv("MODEL_PROVIDER", "ollama"); vi.stubEnv("MODEL_PLANNER", "gemma4:latest"); vi.stubEnv(variable, value);
    const { modelEnv } = await import("./env.ts");
    expect(() => modelEnv()).toThrow(variable);
  });

  it("calls Ollama's chat endpoint with thinking off and a longer timeout; Anthropic keeps 30 s", async () => {
    vi.resetModules();
    vi.stubEnv("MODEL_PROVIDER", "ollama"); vi.stubEnv("MODEL_PLANNER", "gemma4:latest"); vi.stubEnv("OLLAMA_BASE_URL", "");
    const local = (await import("./agent/intake.ts")).modelFromEnv();
    expect(local.model).toMatchObject({ provider: "openai.chat", modelId: "gemma4:latest" });
    expect(local.providerOptions).toEqual({ openai: { reasoningEffort: "none" } });
    expect(local.timeoutMs).toBe(90_000);
    vi.resetModules();
    for (const [name, value] of Object.entries(config)) vi.stubEnv(name, value);
    const remote = (await import("./agent/intake.ts")).modelFromEnv();
    expect(remote.model).toMatchObject({ modelId: "test-model" });
    expect(String((remote.model as { provider: string }).provider)).toMatch(/^anthropic/);
    expect(remote.timeoutMs).toBe(30_000);
    expect(remote.providerOptions).toBeUndefined();
  });
});

describe("reader model and run limits", () => {
  it("uses MODEL_READER when set and the planner model when it is empty", async () => {
    vi.resetModules();
    vi.stubEnv("MODEL_PROVIDER", "ollama"); vi.stubEnv("MODEL_PLANNER", "gemma4:latest"); vi.stubEnv("MODEL_READER", "");
    let models = (await import("./agent/intake.ts")).modelsFromEnv();
    expect(models.reader.model).toMatchObject({ modelId: "gemma4:latest" });
    vi.resetModules(); vi.stubEnv("MODEL_READER", "qwen3.5:9b");
    models = (await import("./agent/intake.ts")).modelsFromEnv();
    expect(models.planner.model).toMatchObject({ modelId: "gemma4:latest" });
    expect(models.reader.model).toMatchObject({ modelId: "qwen3.5:9b" });
    expect(models.reader.providerOptions).toEqual({ openai: { reasoningEffort: "none" } });
  });

  it("defaults MAX_STEPS to 10 and RUN_TOKEN_BUDGET to 150000, and names invalid values", async () => {
    vi.stubEnv("MAX_STEPS", ""); vi.stubEnv("RUN_TOKEN_BUDGET", "");
    const { runLimits } = await import("./env.ts");
    expect(runLimits()).toEqual({ MAX_STEPS: 10, RUN_TOKEN_BUDGET: 150_000 });
    vi.stubEnv("MAX_STEPS", "6"); vi.stubEnv("RUN_TOKEN_BUDGET", "50000");
    expect(runLimits()).toEqual({ MAX_STEPS: 6, RUN_TOKEN_BUDGET: 50_000 });
    vi.stubEnv("MAX_STEPS", "1");
    expect(() => runLimits()).toThrow("MAX_STEPS");
    vi.stubEnv("MAX_STEPS", "10"); vi.stubEnv("RUN_TOKEN_BUDGET", "lots");
    expect(() => runLimits()).toThrow("RUN_TOKEN_BUDGET");
  });
});
