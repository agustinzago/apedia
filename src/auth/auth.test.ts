import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { createTestDb } from "@/test/db";
import { createAuthAdapter } from "./adapter";
import { createMagicLinkProvider } from "./magic-link";

describe("auth: storing Learners and sessions", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("creates a Learner row on first sign-in and finds it by email afterwards", async () => {
    const adapter = createAuthAdapter(db);

    const created = await adapter.createUser!({
      id: "ignored",
      email: "ana@example.com",
      emailVerified: new Date("2026-09-25T10:00:00Z"),
    });

    const rows = await db.select().from(schema.learner);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: created.id,
      email: "ana@example.com",
      emailVerified: new Date("2026-09-25T10:00:00Z"),
    });
    expect(await adapter.getUserByEmail!("ana@example.com")).toMatchObject({
      id: created.id,
    });
  });

  it("keeps sessions in Postgres until sign-out", async () => {
    const adapter = createAuthAdapter(db);
    const learner = await adapter.createUser!({
      id: "ignored",
      email: "ana@example.com",
      emailVerified: null,
    });
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await adapter.createSession!({ sessionToken: "tok", userId: learner.id, expires });

    expect(
      await db
        .select()
        .from(schema.session)
        .where(eq(schema.session.userId, learner.id)),
    ).toHaveLength(1);
    expect(await adapter.getSessionAndUser!("tok")).toMatchObject({
      session: { sessionToken: "tok", userId: learner.id },
      user: { id: learner.id, email: "ana@example.com" },
    });

    await adapter.deleteSession!("tok");
    expect(await adapter.getSessionAndUser!("tok")).toBeNull();
  });

  it("uses a magic-link token only once", async () => {
    const adapter = createAuthAdapter(db);
    const token = {
      identifier: "ana@example.com",
      token: "hashed",
      expires: new Date(Date.now() + 60_000),
    };
    await adapter.createVerificationToken!(token);

    expect(
      await adapter.useVerificationToken!({ identifier: token.identifier, token: "hashed" }),
    ).toMatchObject({ identifier: "ana@example.com" });
    expect(
      await adapter.useVerificationToken!({ identifier: token.identifier, token: "hashed" }),
    ).toBeNull();
  });
});

describe("auth: delivering the magic link", () => {
  const request = (provider: ReturnType<typeof createMagicLinkProvider>) =>
    provider.sendVerificationRequest({
      identifier: "ana@example.com",
      url: "http://localhost:3000/api/auth/callback/resend?token=abc",
      expires: new Date(),
      provider,
      token: "abc",
      theme: {},
      request: new Request("http://localhost:3000"),
    });

  it("prints the link to the console instead of emailing it in development", async () => {
    const log = vi.fn();
    const fetch = vi.spyOn(globalThis, "fetch");

    await request(createMagicLinkProvider({ delivery: "console", log }));

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        "http://localhost:3000/api/auth/callback/resend?token=abc",
      ),
    );
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("emails the link through Resend in production", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    const provider = createMagicLinkProvider({
      delivery: "email",
      from: "Apedia <sign-in@example.com>",
    });

    // Auth.js merges a provider's options over its defaults at runtime.
    await request({ ...provider, ...provider.options, apiKey: "re_test" });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer re_test" }),
      }),
    );
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      from: "Apedia <sign-in@example.com>",
      to: "ana@example.com",
      subject: "Your Apedia sign-in link",
    });
    expect(body.html).toContain('href="http://localhost:3000/api/auth/callback/resend?token=abc"');
    expect(body.text).toContain("http://localhost:3000/api/auth/callback/resend?token=abc");
    fetch.mockRestore();
  });

  it("fails the sign-in when Resend refuses the email", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("domain not verified", { status: 403 }));
    const provider = createMagicLinkProvider({ delivery: "email" });

    await expect(request({ ...provider, ...provider.options, apiKey: "re_test" })).rejects.toThrow(
      "Resend answered 403: domain not verified",
    );
    fetch.mockRestore();
  });
});
