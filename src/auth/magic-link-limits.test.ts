import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createTestDb } from "@/test/db";
import {
  clientIp,
  createMagicLinkLimiter,
  DEFAULT_MAGIC_LINK_LIMITS,
  type MagicLinkLimiter,
} from "./magic-link-limits";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const refused = { ok: false, reason: "too-many-links" };

describe("auth: limiting magic-link emails", () => {
  let db: Db;
  let limiter: MagicLinkLimiter;
  /** The time the limiter thinks it is. */
  let clock: Date;

  const later = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };

  /** Asks for `n` links, returning what each answered. */
  const ask = async (n: number, email: string, ip: string | null = "203.0.113.7") => {
    const results = [];
    for (let i = 0; i < n; i++) results.push(await limiter.allow({ email, ip }));
    return results;
  };

  beforeEach(async () => {
    db = await createTestDb();
    clock = new Date("2026-09-28T10:00:00Z");
    limiter = createMagicLinkLimiter({
      db,
      limits: DEFAULT_MAGIC_LINK_LIMITS,
      secret: "test-secret",
      now: () => clock,
    });
  });

  it("sends links under the limit", async () => {
    expect(await ask(2, "ana@example.com")).toEqual([{ ok: true }, { ok: true }]);
    expect(await db.select().from(schema.magicLinkRequest)).toHaveLength(2);
  });

  it("sends the link that reaches the limit and refuses the next, without recording it", async () => {
    expect(await ask(3, "ana@example.com")).toEqual([{ ok: true }, { ok: true }, { ok: true }]);

    expect(await limiter.allow({ email: "ana@example.com", ip: "198.51.100.1" })).toEqual(refused);
    expect(await db.select().from(schema.magicLinkRequest)).toHaveLength(3);
  });

  it("counts an address however it is typed", async () => {
    await ask(3, "ana@example.com");

    expect(await limiter.allow({ email: " Ana@Example.COM ", ip: null })).toEqual(refused);
  });

  it("limits each address on its own", async () => {
    await ask(3, "ana@example.com", null);

    expect(await limiter.allow({ email: "ben@example.com", ip: null })).toEqual({ ok: true });
  });

  it("limits the links one IP asks for, whatever the addresses", async () => {
    for (let i = 0; i < 20; i++) {
      expect(await limiter.allow({ email: `learner${i}@example.com`, ip: "203.0.113.7" })).toEqual({
        ok: true,
      });
    }

    expect(await limiter.allow({ email: "ana@example.com", ip: "203.0.113.7" })).toEqual(refused);
    expect(await limiter.allow({ email: "ana@example.com", ip: "198.51.100.1" })).toEqual({
      ok: true,
    });
  });

  it("sends again once the oldest link is an hour old", async () => {
    await ask(1, "ana@example.com");
    later(20 * MINUTE_MS);
    await ask(2, "ana@example.com");

    later(40 * MINUTE_MS - 1);
    expect(await limiter.allow({ email: "ana@example.com", ip: null })).toEqual(refused);
    later(1);
    expect(await limiter.allow({ email: "ana@example.com", ip: null })).toEqual({ ok: true });
    expect(await limiter.allow({ email: "ana@example.com", ip: null })).toEqual(refused);
  });

  it("allows 10 links to an address per UTC day, starting again at midnight", async () => {
    clock = new Date("2026-09-28T20:00:00Z");
    for (let hour = 0; hour < 3; hour++) {
      await ask(3, "ana@example.com", null);
      later(HOUR_MS);
    }
    // Only one link in this hour, but the day's 10th.
    expect(await ask(2, "ana@example.com", null)).toEqual([{ ok: true }, refused]);

    clock = new Date("2026-09-28T23:59:59Z");
    expect(await limiter.allow({ email: "ana@example.com", ip: null })).toEqual(refused);
    clock = new Date("2026-09-29T00:00:00Z");
    expect(await limiter.allow({ email: "ana@example.com", ip: null })).toEqual({ ok: true });
  });

  it("stores a keyed hash of the address, never the address", async () => {
    await ask(1, "ana@example.com");

    const [row] = await db.select().from(schema.magicLinkRequest);
    expect(row).toMatchObject({ ip: "203.0.113.7", createdAt: clock });
    expect(JSON.stringify(row)).not.toContain("ana");
    expect(row.emailHash).toMatch(/^[0-9a-f]{64}$/);

    // Without the secret, hashing a guessed address finds nothing.
    const otherDb = await createTestDb();
    await createMagicLinkLimiter({
      db: otherDb,
      limits: DEFAULT_MAGIC_LINK_LIMITS,
      secret: "another-secret",
      now: () => clock,
    }).allow({ email: "ana@example.com", ip: null });
    const [otherRow] = await otherDb.select().from(schema.magicLinkRequest);
    expect(otherRow.emailHash).not.toBe(row.emailHash);
  });

  it("prunes rows older than a day", async () => {
    await ask(1, "ana@example.com");
    later(24 * HOUR_MS + 1);

    await ask(1, "ben@example.com");

    const rows = await db.select().from(schema.magicLinkRequest);
    expect(rows).toHaveLength(1);
    expect(rows[0].createdAt).toEqual(clock);
  });
});

describe("auth: the requesting IP", () => {
  it("is the first address in x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIp(new Headers({ "x-forwarded-for": " 2001:db8::1 " }))).toBe("2001:db8::1");
  });

  it("is unknown without the header, as in local development", () => {
    expect(clientIp(new Headers())).toBeNull();
    expect(clientIp(new Headers({ "x-forwarded-for": "" }))).toBeNull();
  });
});
