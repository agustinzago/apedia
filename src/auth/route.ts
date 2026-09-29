type Handler<R extends Request> = (request: R) => Promise<Response>;

/** Auth.js's own sign-in endpoints, `/api/auth/signin` and `/api/auth/signin/<provider>`. */
const SIGN_IN_PATH = /^\/api\/auth\/signin(\/|$)/;

/**
 * Auth.js's route, less its sign-in endpoints. Its POST
 * `/api/auth/signin/resend` sends a magic link to any address with only a
 * CSRF token, which skips the "13 or older" check and the per-address and
 * per-IP limits that `requestMagicLink` applies first. Our form never uses
 * it: the server-side `signIn` calls Auth.js directly, not through this
 * route. The magic link's callback, the session and sign-out pass through.
 */
export function refuseDirectSignIn<R extends Request>(handlers: {
  GET: Handler<R>;
  POST: Handler<R>;
}): { GET: Handler<R>; POST: Handler<R> } {
  const guard =
    (handler: Handler<R>): Handler<R> =>
    async (request) =>
      SIGN_IN_PATH.test(new URL(request.url).pathname)
        ? new Response("Not found", { status: 404 })
        : handler(request);
  return { GET: guard(handlers.GET), POST: guard(handlers.POST) };
}
