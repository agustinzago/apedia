/**
 * The network half of the Resource URL check: one GET, reporting what came
 * back. The rules for what to keep live in `course`; tests swap in the fake
 * from `@/url-fetcher/fake`.
 */

export type UrlCheck =
  | { kind: "status"; status: number }
  | { kind: "dns" }
  | { kind: "timeout" }
  | { kind: "network" };

export type UrlFetcher = (url: string) => Promise<UrlCheck>;

export const URL_CHECK_TIMEOUT_MS = 5_000;

/** Many sites turn away clients that don't look like a browser. */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** GETs the URL, following redirects, with a browser-like User-Agent and a timeout. */
export function createUrlFetcher({
  timeoutMs = URL_CHECK_TIMEOUT_MS,
}: { timeoutMs?: number } = {}): UrlFetcher {
  return async (url) => {
    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "User-Agent": BROWSER_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en;q=0.9,*;q=0.5",
        },
      });
      // Only the status matters; don't download the page.
      await response.body?.cancel().catch(() => {});
      return { kind: "status", status: response.status };
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return { kind: "timeout" };
      }
      const code = (error as { cause?: { code?: unknown } }).cause?.code;
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") return { kind: "dns" };
      return { kind: "network" };
    }
  };
}
