import type { UrlCheck, UrlFetcher } from ".";

/**
 * A URL fetcher that never touches the network. Give each URL a status code
 * or an outcome; any other URL answers 200. It also stands in for the real
 * one alongside the stand-in Teacher, whose Resources are made up.
 */
export type FakeUrlFetcher = UrlFetcher & {
  /** Every URL fetched, in order. */
  calls: string[];
};

export function createFakeUrlFetcher(
  outcomes: Record<string, number | UrlCheck> = {},
): FakeUrlFetcher {
  const calls: string[] = [];
  const fetchUrl = async (url: string): Promise<UrlCheck> => {
    calls.push(url);
    const outcome = outcomes[url] ?? 200;
    return typeof outcome === "number" ? { kind: "status", status: outcome } : outcome;
  };
  return Object.assign(fetchUrl, { calls });
}
