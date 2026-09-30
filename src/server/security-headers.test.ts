import { describe, expect, it } from "vitest";
import { securityHeaders } from "./security-headers";

const byKey = (dev: boolean) =>
  Object.fromEntries(securityHeaders({ dev }).map((h) => [h.key, h.value]));

describe("server: security headers", () => {
  it("keeps other sites from framing any page", () => {
    const headers = byKey(false);
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("loads scripts, styles, images and fonts only from the site itself, and no plugins", () => {
    const csp = byKey(false)["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/\n/);
  });

  it("allows eval only in development, where React needs it", () => {
    expect(byKey(true)["Content-Security-Policy"]).toContain("'unsafe-eval'");
  });

  it("stops MIME sniffing and keeps full URLs from leaving the site", () => {
    const headers = byKey(false);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });
});
