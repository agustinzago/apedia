import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUrlFetcher } from ".";

describe("url-fetcher: one GET per Resource URL", () => {
  let server: Server;
  let base: string;
  const seen: { method?: string; userAgent?: string }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      seen.push({ method: request.method, userAgent: request.headers["user-agent"] });
      const path = request.url ?? "/";
      if (path === "/slow") return; // never answers
      if (path === "/moved") {
        response.writeHead(301, { Location: "/gone" }).end();
        return;
      }
      const status = Number(path.slice(1)) || (path === "/gone" ? 410 : 200);
      response.writeHead(status, { "Content-Type": "text/html" }).end("<p>hello</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("GETs with a browser-like User-Agent and reports the status", async () => {
    const fetchUrl = createUrlFetcher();

    expect(await fetchUrl(`${base}/200`)).toEqual({ kind: "status", status: 200 });
    expect(await fetchUrl(`${base}/403`)).toEqual({ kind: "status", status: 403 });
    expect(await fetchUrl(`${base}/503`)).toEqual({ kind: "status", status: 503 });
    expect(seen.at(-1)?.method).toBe("GET");
    expect(seen.at(-1)?.userAgent).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
  });

  it("follows redirects to the final status", async () => {
    expect(await createUrlFetcher()(`${base}/moved`)).toEqual({ kind: "status", status: 410 });
  });

  it("gives up after the timeout", async () => {
    expect(await createUrlFetcher({ timeoutMs: 200 })(`${base}/slow`)).toEqual({
      kind: "timeout",
    });
  });

  it("reports a domain that does not resolve", async () => {
    // .invalid is reserved and never resolves.
    expect(await createUrlFetcher()("http://apedia-test.invalid/")).toEqual({ kind: "dns" });
  });

  it("reports a refused connection as a network failure", async () => {
    // Port 9 (discard) is closed on the loopback interface.
    expect(await createUrlFetcher()("http://127.0.0.1:9/")).toEqual({ kind: "network" });
  });
});
