import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * The network half of the Resource URL check: one GET, reporting what came
 * back. The rules for what to keep live in `course`; tests swap in the fake
 * from `@/url-fetcher/fake`.
 */

export type UrlCheck =
  | { kind: "status"; status: number }
  | { kind: "dns" }
  | { kind: "timeout" }
  | { kind: "network" }
  /** The URL, or a redirect on the way, leads to an address that is not public. */
  | { kind: "blocked" };

export type UrlFetcher = (url: string) => Promise<UrlCheck>;

export const URL_CHECK_TIMEOUT_MS = 5_000;

/** Many sites turn away clients that don't look like a browser. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Redirects followed before giving up; plenty for http → https → www → a locale. */
const MAX_REDIRECTS = 10;

/**
 * Loopback, private, link-local, shared, benchmarking, multicast, reserved,
 * NAT64, unique-local and unspecified ranges.
 */
const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 0) return false;
  return !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** The host's addresses, or the timeout's error once `signal` fires: a slow resolver counts against it too. */
async function resolve(host: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const found = await Promise.race([lookup(host, { all: true }), aborted]);
    return found.map((a) => a.address);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/**
 * GETs the URL with a browser-like User-Agent and a timeout, following
 * redirects itself so that each one is checked: the URL and every redirect
 * must be http(s) and resolve only to public addresses. A page from the
 * search results can't point the check at an internal address. (A host
 * that resolves differently between the check and the GET could still slip
 * through; the page is never read, only its status.)
 */
export function createUrlFetcher({
  timeoutMs = URL_CHECK_TIMEOUT_MS,
  isPublicAddress: isPublic = isPublicAddress,
}: { timeoutMs?: number; isPublicAddress?: (address: string) => boolean } = {}): UrlFetcher {
  async function reachable(url: URL, signal: AbortSignal): Promise<boolean> {
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
    const addresses = isIP(host) ? [host] : await resolve(host, signal);
    return addresses.length > 0 && addresses.every(isPublic);
  }

  return async (raw) => {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      let url = new URL(raw);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!(await reachable(url, signal))) return { kind: "blocked" };
        const response = await fetch(url, {
          method: "GET",
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": BROWSER_USER_AGENT,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en;q=0.9,*;q=0.5",
          },
        });
        // Only the status matters; don't download the page.
        await response.body?.cancel().catch(() => {});
        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || location === null) {
          return { kind: "status", status: response.status };
        }
        url = new URL(location, url);
      }
      return { kind: "network" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { kind: "timeout" };
      }
      // fetch wraps the DNS error in `cause`; the redirect check's lookup throws it bare.
      const failure = error as { code?: unknown; cause?: { code?: unknown } };
      const code = failure.cause?.code ?? failure.code;
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { kind: "dns" };
      return { kind: "network" };
    }
  };
}
