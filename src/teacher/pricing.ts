/** The models the Teacher uses, and what Claude charges for them. */

export const HAIKU = "claude-haiku-4-5-20251001";
export const SONNET = "claude-sonnet-5";
export type Model = typeof HAIKU | typeof SONNET;

/** List prices in US dollars per million tokens (Claude API, September 2026). */
const PRICES: Record<Model, { input: number; output: number }> = {
  [HAIKU]: { input: 1, output: 5 },
  [SONNET]: { input: 2, output: 10 },
};

/** Writing the prompt cache costs 1.25× input; reading it, 0.1×. */
const CACHE_WRITE_RATE = 1.25;
const CACHE_READ_RATE = 0.1;

/** $10 per 1,000 web searches. */
export const WEB_SEARCH_USD = 0.01;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  webSearches: number;
};

/** What one call cost, in US dollars. */
export function costUsd(model: Model, usage: TokenUsage): number {
  const price = PRICES[model];
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * CACHE_WRITE_RATE) +
    usage.cacheReadTokens * perToken(price.input * CACHE_READ_RATE) +
    usage.outputTokens * perToken(price.output) +
    usage.webSearches * WEB_SEARCH_USD
  );
}
