/**
 * The headers every page is served with. The Content-Security-Policy is
 * Next's "without nonces" one: scripts, styles, images and fonts come only
 * from the site itself (next/font hosts the fonts, and Vercel Analytics
 * loads from /_vercel), no plugins, and no other site may frame a page, so
 * none can trick a Learner into clicking "Delete account" (clickjacking).
 * `form-action` is left out: "Buy a Course" redirects to Polar's checkout.
 * Development adds eval, which React needs, and Analytics' debug script;
 * Preview deployments add Vercel's toolbar.
 */
export function securityHeaders({
  dev,
  preview = false,
}: {
  dev: boolean;
  preview?: boolean;
}): { key: string; value: string }[] {
  const toolbar = preview ? " https://vercel.live" : "";
  const csp = [
    "default-src 'self'",
    // Next's inline bootstrap scripts need 'unsafe-inline' without nonces.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval' https://va.vercel-scripts.com" : ""}${toolbar}`,
    `style-src 'self' 'unsafe-inline'${toolbar}`,
    `img-src 'self' blob: data:${preview ? " https://vercel.live https://vercel.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    ...(preview
      ? ["connect-src 'self' https://vercel.live wss://ws-us3.pusher.com", "frame-src https://vercel.live"]
      : []),
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    // For browsers that predate frame-ancestors.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ];
}
