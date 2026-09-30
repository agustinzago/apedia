import { afterEach, describe, expect, it, vi } from "vitest";
import { startJobStep } from "./jobs";

describe("server: starting a job step", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("gets past Vercel's Deployment Protection on a protected Preview, such as staging", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "bypass-secret");

    await startJobStep("job 1", "https://apedia-git-staging.vercel.app");

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://apedia-git-staging.vercel.app/api/jobs/job%201");
    expect(new Headers(init?.headers).get("x-vercel-protection-bypass")).toBe("bypass-secret");
  });

  it("sends no bypass header where there is no secret, as locally", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VERCEL_AUTOMATION_BYPASS_SECRET", "");

    await startJobStep("job-1", "http://localhost:3000");

    expect(new Headers(fetch.mock.calls[0][1]?.headers).has("x-vercel-protection-bypass")).toBe(
      false,
    );
  });
});
