import { describe, expect, it, vi } from "vitest";
import { jobStartHeaders, receiveJobStart } from "./job-start";

const secret = "test-secret";

describe("server: starting a job step", () => {
  const post = (jobId: string, headers: HeadersInit = {}) => {
    const run = vi.fn(async () => {});
    const response = receiveJobStart(
      new Request(`http://localhost/api/jobs/${jobId}`, { method: "POST", headers }),
      jobId,
      { secret, run },
    );
    return { response, run };
  };

  it("runs the step when the app itself asks", async () => {
    const { response, run } = post("job-1", jobStartHeaders("job-1", secret));

    expect((await response).status).toBe(202);
    expect(run).toHaveBeenCalledOnce();
  });

  it("refuses anyone else, without running anything", async () => {
    const unsigned = post("job-1");
    const forged = post("job-1", { "x-apedia-job-token": "0".repeat(64) });
    const anotherJobs = post("job-2", jobStartHeaders("job-1", secret));
    const otherSecret = post("job-1", jobStartHeaders("job-1", "another-secret"));

    for (const { response, run } of [unsigned, forged, anotherJobs, otherSecret]) {
      expect((await response).status).toBe(404);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("refuses everyone when there is no secret to check against", async () => {
    const run = vi.fn(async () => {});
    const response = await receiveJobStart(
      new Request("http://localhost/api/jobs/job-1", { method: "POST" }),
      "job-1",
      { secret: undefined, run },
    );

    expect(response.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });
});
