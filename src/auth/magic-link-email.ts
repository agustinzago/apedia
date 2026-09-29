/**
 * The sign-in email, drawn in the notebook style of the site (design/,
 * globals.css). Email clients ignore most modern CSS, so the layout is
 * tables with inline styles, colours are hex (oklch tokens converted), and
 * the handwritten fonts fall back to system ones where web fonts don't load.
 * The one <style> block only adds the phone layout and link fixes.
 */

const ink = "#1e1e1e";
const inkSecondary = "#3d3d3d";
const inkMuted = "#5b5b5b";
const paper = "#fbfaf6";
const paperGrid = "#eceff4";
const highlighter = "#fbe991"; // oklch(0.93 0.11 98)
const blue = "#2063b0"; // oklch(0.5 0.14 255)
const stickyYellow = "#fff2bd"; // oklch(0.96 0.07 95)

const headingFont = "Kalam,'Segoe Print','Bradley Hand',Arial,sans-serif";
const bodyFont = "'Patrick Hand','Trebuchet MS',Arial,sans-serif";

const highlight = (text: string, padding = 6) =>
  `<span style="background-color:${highlighter};background-image:linear-gradient(104deg,rgba(251,233,145,0) 1%,${highlighter} 4%,${highlighter} 96%,rgba(251,233,145,0) 99%);padding:0 ${padding}px">${text}</span>`;

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subject, HTML and plain text for a magic link. Images load from the link's own origin. */
export function magicLinkEmail(url: string) {
  const origin = new URL(url).origin;
  const host = new URL(url).host;
  const link = escapeHtml(url);
  const subject = "Your Apedia sign-in link";
  const preheader = "Open it and you’re in: no password to remember.";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${subject}</title>
<link href="https://fonts.googleapis.com/css2?family=Kalam:wght@700&amp;family=Patrick+Hand&amp;display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light only; supported-color-schemes: light only; }
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; }
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
  @media (max-width: 600px) {
    .page { padding: 20px 12px 32px !important; }
    .card { padding: 32px 20px 28px !important; }
    .title { font-size: 34px !important; }
    .lede { font-size: 18px !important; }
    .button-table { width: 100% !important; }
    .button { display: block !important; padding: 16px 12px !important; font-size: 22px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${paper}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${paper}" style="background-color:${paper};background-image:linear-gradient(to right,${paperGrid} 1px,transparent 1px),linear-gradient(to bottom,${paperGrid} 1px,transparent 1px);background-size:22px 22px">
  <tr>
    <td class="page" align="center" style="padding:40px 16px 48px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px">
        <tr>
          <td align="center" style="padding:0 0 20px;font-family:${headingFont};font-weight:700;font-size:28px;line-height:1;color:${ink}">
            <a href="${origin}" style="color:${ink};text-decoration:none">Ape${highlight("dia", 2)}</a>
          </td>
        </tr>
        <tr>
          <td class="card" align="center" bgcolor="#ffffff" style="background-color:#ffffff;border:2px solid ${ink};border-radius:255px 15px 225px 15px / 15px 225px 15px 255px;padding:40px 44px 36px;box-shadow:2px 3px 0 rgba(30,30,30,0.16)">
            <img src="${origin}/email/ape.png" width="88" height="88" alt="Ape, your teacher" style="display:block;width:88px;height:88px;border:0;border-radius:50%;margin:0 auto 18px">
            <h1 class="title" style="margin:0 0 14px;font-family:${headingFont};font-weight:700;font-size:40px;line-height:1.1;color:${ink}">${highlight("Sign in")} to Apedia</h1>
            <p class="lede" style="margin:0 0 28px;font-family:${bodyFont};font-size:20px;line-height:1.45;color:${inkSecondary}">Press the button and you’re in: no password to remember. The link works once and expires in 24&nbsp;hours.</p>
            <table class="button-table" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
              <tr>
                <td align="center" bgcolor="${ink}" style="background-color:${ink};border:2px solid ${ink};border-radius:15px 225px 15px 255px / 255px 15px 225px 15px">
                  <a class="button" href="${link}" target="_blank" style="display:inline-block;padding:14px 36px;font-family:${headingFont};font-weight:700;font-size:22px;line-height:1.2;color:${paper};text-decoration:none">Sign in</a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 6px;font-family:${bodyFont};font-size:16px;line-height:1.4;color:${inkMuted}">Button not working? Paste this link into your browser:</p>
            <p style="margin:0;font-family:${bodyFont};font-size:14px;line-height:1.4;word-break:break-all"><a href="${link}" target="_blank" style="color:${blue};text-decoration:underline">${link}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td bgcolor="${stickyYellow}" style="background-color:${stickyYellow};padding:16px 20px;box-shadow:2px 3px 0 rgba(30,30,30,0.16);font-family:${bodyFont};font-size:17px;line-height:1.4;color:${inkSecondary}">
                  Didn’t ask for this? You can ignore this email: nobody can sign in without the link.
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:24px 0 0;font-family:${bodyFont};font-size:15px;line-height:1.4;color:${inkMuted}">
            Sent by <a href="${origin}" style="color:${inkMuted};text-decoration:underline">${escapeHtml(host)}</a> because someone asked to sign in with this address.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = [
    "Sign in to Apedia",
    "",
    "Open this link and you’re in: no password to remember.",
    url,
    "",
    "It works once and expires in 24 hours.",
    "Didn’t ask for this? You can ignore this email: nobody can sign in without the link.",
    "",
  ].join("\n");

  return { subject, html, text };
}
