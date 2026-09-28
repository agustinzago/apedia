import { describe, expect, it } from "vitest";
import {
  anthropicKeyProblem,
  checkAnthropicKey,
  checkLiveSignIn,
  checkResendDomain,
  databaseUrlProblem,
  generateAuthSecret,
  mask,
  parseFromAddress,
  parseSiteUrl,
  resendKeyProblem,
  type Fetch,
} from "./checks";
import { parseEnvFile, serializeEnvFile } from "./env-file";

function answering(status: number, body: unknown): Fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("env file", () => {
  it("round-trips values with spaces, quotes and angle brackets", () => {
    const values = {
      AUTH_EMAIL_FROM: "Apedia <sign-in@apedia.app>",
      AUTH_SECRET: 'a"b\\c=',
      DATABASE_URL: "postgresql://u:p@host/db?sslmode=require",
    };
    const text = serializeEnvFile(values, "Recorded by the wizard.\nDo not commit.");
    expect(text).toMatch(/^# Recorded by the wizard\.\n# Do not commit\.\n/);
    expect(parseEnvFile(text)).toEqual(values);
  });

  it("reads unquoted values and skips comments and blank lines", () => {
    expect(parseEnvFile("# note\n\nAUTH_URL=https://apedia.app\n")).toEqual({
      AUTH_URL: "https://apedia.app",
    });
  });
});

describe("shape checks", () => {
  it("accepts a Neon connection string and rejects anything else", () => {
    expect(
      databaseUrlProblem("postgresql://apedia:pw@ep-x.eu-central-1.aws.neon.tech/neondb?sslmode=require"),
    ).toBeUndefined();
    expect(databaseUrlProblem("mysql://u:p@host/db")).toMatch(/postgresql:\/\//);
    expect(databaseUrlProblem("postgresql://host/db")).toMatch(/user, a password/);
    expect(databaseUrlProblem("neondb")).toMatch(/not a URL/);
  });

  it("knows what the API keys look like", () => {
    expect(anthropicKeyProblem("sk-ant-api03-abc")).toBeUndefined();
    expect(anthropicKeyProblem("re_abc")).toBeDefined();
    expect(resendKeyProblem("re_abc")).toBeUndefined();
    expect(resendKeyProblem("sk-ant-abc")).toBeDefined();
  });

  it("finds the sender's domain", () => {
    expect(parseFromAddress("Apedia <sign-in@Apedia.app>")).toEqual({ domain: "apedia.app" });
    expect(parseFromAddress("sign-in@mail.apedia.app")).toEqual({ domain: "mail.apedia.app" });
    expect(parseFromAddress("Apedia")).toHaveProperty("problem");
    expect(parseFromAddress("Apedia <onboarding@resend.dev>")).toHaveProperty("problem");
  });

  it("wants the site as a bare https origin", () => {
    expect(parseSiteUrl("https://apedia.app/")).toEqual({ origin: "https://apedia.app" });
    expect(parseSiteUrl("http://apedia.app")).toHaveProperty("problem");
    expect(parseSiteUrl("https://apedia.app/sign-in")).toHaveProperty("problem");
    expect(parseSiteUrl("apedia.app")).toHaveProperty("problem");
  });

  it("generates a fresh 32-byte secret each time", () => {
    const secret = generateAuthSecret();
    expect(Buffer.from(secret, "base64")).toHaveLength(32);
    expect(generateAuthSecret()).not.toBe(secret);
  });

  it("never shows a whole secret", () => {
    expect(mask("sk-ant-api03-abcdefghijklmnop")).toBe("sk-ant…mnop");
    expect(mask("short")).toBe("•••••");
  });
});

describe("online checks", () => {
  it("tells a working Anthropic key from a rejected one", async () => {
    expect(await checkAnthropicKey("k", answering(200, { data: [] }))).toEqual({ status: "ok" });
    expect(await checkAnthropicKey("k", answering(401, {}))).toMatchObject({ status: "failed" });
    expect(await checkAnthropicKey("k", answering(529, {}))).toMatchObject({ status: "unchecked" });
  });

  it("wants the sender's domain verified in Resend", async () => {
    const domains = (status: string) =>
      answering(200, { data: [{ name: "apedia.app", status }] });
    expect(await checkResendDomain("re_k", "apedia.app", domains("verified"))).toEqual({
      status: "ok",
    });
    expect(await checkResendDomain("re_k", "apedia.app", domains("pending"))).toMatchObject({
      status: "failed",
      problem: expect.stringMatching(/pending/),
    });
    expect(await checkResendDomain("re_k", "other.app", domains("verified"))).toMatchObject({
      status: "failed",
      problem: expect.stringMatching(/not in this Resend account/),
    });
    expect(await checkResendDomain("re_k", "apedia.app", answering(401, {}))).toMatchObject({
      status: "failed",
    });
  });

  it("cannot check the domain with a sending-only Resend key", async () => {
    const restricted = answering(401, { name: "restricted_api_key", statusCode: 401 });
    expect(await checkResendDomain("re_k", "apedia.app", restricted)).toMatchObject({
      status: "unchecked",
    });
  });

  it("wants the live site to offer magic-link sign-in", async () => {
    expect(await checkLiveSignIn("https://a.app", answering(200, { resend: {} }))).toEqual({
      status: "ok",
    });
    expect(await checkLiveSignIn("https://a.app", answering(200, {}))).toMatchObject({
      status: "failed",
    });
    expect(await checkLiveSignIn("https://a.app", answering(500, {}))).toMatchObject({
      status: "failed",
    });
    const offline: Fetch = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await checkLiveSignIn("https://a.app", offline)).toMatchObject({
      status: "failed",
      problem: expect.stringMatching(/ENOTFOUND/),
    });
  });
});
