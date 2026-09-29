import Link from "next/link";
import styles from "./site-footer.module.css";

/** Matt Pocock's /teach skill, the method Apedia runs. */
export const TEACH_SKILL_URL =
  "https://github.com/mattpocock/skills/tree/main/skills/productivity/teach";

export function SiteFooter() {
  return (
    <footer data-noprint className={styles.footer}>
      <p className={styles.credit}>
        Apedia teaches with Matt Pocock’s <a href={TEACH_SKILL_URL}>/teach</a> method.
      </p>
      <nav aria-label="Small print" className={styles.links}>
        <Link href="/pricing">Pricing</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/refunds">Refund policy</Link>
        <Link href="/credits">Credits</Link>
      </nav>
    </footer>
  );
}
