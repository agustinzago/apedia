import type { UrlCheck } from "@/url-fetcher";

/** What the URL check decided for one Resource. */
export type UrlVerdict =
  | { keep: true; outcome: "ok" | "blocked" }
  | { keep: false; reason: string };

/**
 * Below 400: keep. 403 or 429: keep as blocked, since the URL came from the
 * search results and bot walls are common on live sites. Anything else (404,
 * 410, 5xx, DNS failure, timeout): drop.
 */
export function verdictFor(check: UrlCheck): UrlVerdict {
  switch (check.kind) {
    case "status":
      if (check.status < 400) return { keep: true, outcome: "ok" };
      if (check.status === 403 || check.status === 429) {
        return { keep: true, outcome: "blocked" };
      }
      return { keep: false, reason: `answered ${check.status}` };
    case "dns":
      return { keep: false, reason: "its domain does not resolve" };
    case "timeout":
      return { keep: false, reason: "it timed out" };
    case "network":
      return { keep: false, reason: "it could not be reached" };
    case "blocked":
      return { keep: false, reason: "it leads to an address that is not public" };
  }
}

/** The URL if it is an http(s) address on a public host, otherwise null. */
export function publicUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    /^[\d.]+$/.test(host) ||
    host.startsWith("[")
  ) {
    return null;
  }
  return url;
}

/**
 * A key under which two spellings of the same page match: scheme, "www.",
 * trailing slash and fragment are ignored.
 */
export function urlKey(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  return `${host}${path}${url.search}`;
}

/** Shops and catalogues that sell books, plus Goodreads. Matched on any subdomain. */
const BOOK_STORE_DOMAINS = [
  "goodreads.com",
  "amzn.to",
  "amzn.eu",
  "a.co",
  "barnesandnoble.com",
  "bookshop.org",
  "bookdepository.com",
  "books.apple.com",
  "play.google.com",
  "books.google.com",
  "kobo.com",
  "thriftbooks.com",
  "alibris.com",
  "betterworldbooks.com",
  "biblio.com",
  "powells.com",
  "waterstones.com",
  "blackwells.co.uk",
  "whsmith.co.uk",
  "foyles.co.uk",
  "wordery.com",
  "booktopia.com.au",
  "indigo.ca",
  "chapters.indigo.ca",
  "walmart.com",
  "target.com",
  "booksamillion.com",
  "casadellibro.com",
  "elcorteingles.es",
  "cuspide.com",
  "bol.com",
  "thalia.de",
  "hugendubel.de",
  "libreriasgandhi.com.mx",
  "gandhi.com.mx",
];

/** Store brands that sell books under many country domains, such as amazon.es. */
const BOOK_STORE_BRANDS = [
  "amazon",
  "ebay",
  "audible",
  "abebooks",
  "fnac",
  "mercadolibre",
  "mercadolivre",
  "buscalibre",
  "rakuten",
  "scribd",
  "everand",
];

/**
 * A book must link to a stable page, on openlibrary.org or its publisher's
 * site, never to a store or Goodreads. Returns why the URL is not allowed,
 * or null if it is.
 */
export function bookUrlProblem(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const onDomain = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (onDomain("openlibrary.org")) return null;
  if (onDomain("goodreads.com")) return "Goodreads is not a stable book page";
  const labels = host.split(".");
  if (
    BOOK_STORE_DOMAINS.some(onDomain) ||
    BOOK_STORE_BRANDS.some((brand) => labels.slice(0, -1).includes(brand))
  ) {
    return "a store is not a stable book page";
  }
  // Anything else is taken to be the publisher's own site.
  return null;
}
