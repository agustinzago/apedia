import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "./magic-link-email";

const url = "https://apedia.app/api/auth/callback/resend?callbackUrl=%2F&token=abc&email=ana%40example.com";

describe("magic-link email", () => {
  it("links the button to the magic link, escaped for HTML", () => {
    const { html } = magicLinkEmail(url);

    expect(html).toContain(
      'href="https://apedia.app/api/auth/callback/resend?callbackUrl=%2F&amp;token=abc&amp;email=ana%40example.com"',
    );
    expect(html).not.toContain("&token=");
  });

  it("loads the Ape from the site the link points to", () => {
    const { html } = magicLinkEmail(url);

    expect(html).toContain('src="https://apedia.app/email/ape.png"');
  });

  it("carries the raw link in the plain-text part", () => {
    const { subject, text } = magicLinkEmail(url);

    expect(subject).toBe("Your Apedia sign-in link");
    expect(text).toContain(url);
  });
});
