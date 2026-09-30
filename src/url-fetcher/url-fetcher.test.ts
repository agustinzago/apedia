import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUrlFetcher, isPublicAddress } from ".";

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
      if (path === "/to-internal") {
        response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
        return;
      }
      if (path === "/loop") {
        response.writeHead(302, { Location: "/loop" }).end();
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
    const fetchUrl = createUrlFetcher(localOnly);

    expect(await fetchUrl(`${base}/200`)).toEqual({ kind: "status", status: 200 });
    expect(await fetchUrl(`${base}/403`)).toEqual({ kind: "status", status: 403 });
    expect(await fetchUrl(`${base}/503`)).toEqual({ kind: "status", status: 503 });
    expect(seen.at(-1)?.method).toBe("GET");
    expect(seen.at(-1)?.userAgent).toMatch(/^Mozilla\/5\.0 .*Chrome\//);
  });

  /** The test server is on the loopback address, which the real check refuses. */
  const localOnly = { isPublicAddress: (address: string) => address === "127.0.0.1" };

  it("follows redirects to the final status", async () => {
    expect(await createUrlFetcher(localOnly)(`${base}/moved`)).toEqual({ kind: "status", status: 410 });
  });

  it("refuses a redirect to an address that is not public, without fetching it", async () => {
    expect(await createUrlFetcher(localOnly)(`${base}/to-internal`)).toEqual({ kind: "blocked" });
  });

  it("refuses a URL whose host is not public, before fetching it", async () => {
    const before = seen.length;
    expect(await createUrlFetcher()(`${base}/200`)).toEqual({ kind: "blocked" });
    expect(seen).toHaveLength(before);
  });

  it("stops after a few redirects", async () => {
    expect(await createUrlFetcher(localOnly)(`${base}/loop`)).toEqual({ kind: "network" });
  });

  it("gives up after the timeout", async () => {
    expect(await createUrlFetcher({ ...localOnly, timeoutMs: 200 })(`${base}/slow`)).toEqual({
      kind: "timeout",
    });
  });

  it("reports a domain that does not resolve", async () => {
    // .invalid is reserved and never resolves.
    expect(await createUrlFetcher()("http://apedia-test.invalid/")).toEqual({ kind: "dns" });
  });

  it("reports a refused connection as a network failure", async () => {
    // Port 9 (discard) is closed on the loopback interface.
    expect(await createUrlFetcher(localOnly)("http://127.0.0.1:9/")).toEqual({ kind: "network" });
  });
});

describe("url-fetcher: which addresses are public", () => {
  it("refuses loopback, private, link-local and unique-local addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "::",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts public addresses", () => {
    for (const address of ["93.184.215.14", "8.8.8.8", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });
});
