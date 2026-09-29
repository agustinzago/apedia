import { describe, expect, it, vi } from "vitest";
import { refuseDirectSignIn } from "./route";

describe("auth route: only our sign-in form sends magic links", () => {
  const handlers = () => ({
    GET: vi.fn(async () => new Response("auth.js")),
    POST: vi.fn(async () => new Response("auth.js")),
  });

  it("refuses a sign-in posted straight to Auth.js, without calling it", async () => {
    const auth = handlers();
    const { POST } = refuseDirectSignIn(auth);

    const response = await POST(
      new Request("https://apedia.app/api/auth/signin/resend", {
        method: "POST",
        body: new URLSearchParams({ email: "stranger@example.com", csrfToken: "t" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(auth.POST).not.toHaveBeenCalled();
  });

  it("refuses Auth.js's own sign-in page too", async () => {
    const auth = handlers();
    const { GET } = refuseDirectSignIn(auth);

    for (const path of ["/api/auth/signin", "/api/auth/signin/resend", "/api/auth/signin/"]) {
      expect((await GET(new Request(`https://apedia.app${path}`))).status).toBe(404);
    }
    expect(auth.GET).not.toHaveBeenCalled();
  });

  it("passes the magic link's callback, the session and sign-out through", async () => {
    const auth = handlers();
    const { GET, POST } = refuseDirectSignIn(auth);

    const callback = await GET(
      new Request("https://apedia.app/api/auth/callback/resend?token=abc&email=a%40b.c"),
    );
    const session = await GET(new Request("https://apedia.app/api/auth/session"));
    const signOut = await POST(
      new Request("https://apedia.app/api/auth/signout", { method: "POST" }),
    );

    expect(await callback.text()).toBe("auth.js");
    expect(await session.text()).toBe("auth.js");
    expect(await signOut.text()).toBe("auth.js");
  });
});
