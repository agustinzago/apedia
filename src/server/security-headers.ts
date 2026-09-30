/**
 * The headers every page is served with. The Content-Security-Policy is
 * Next's "without nonces" one: scripts, styles, images and fonts come only
 * from the site itself (next/font hosts the fonts, and Vercel Analytics
 * loads from /_vercel), no plugins, and no other site may frame a page, so
 * none can trick a Learner into clicking "Delete account" (clickjacking).
 * `form-action` is left out: "Buy a Course" redirects to Polar's checkout.
 */
export function securityHeaders({ dev }: { dev: boolean }): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    // Next's inline bootstrap scripts need 'unsafe-inline' without nonces;
    // React's development build needs eval.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
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
