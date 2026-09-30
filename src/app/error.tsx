"use client";

import Link from "next/link";
import styles from "./home.module.css";

/** Any page that failed to load, such as when the database is briefly unreachable. */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className={styles.main}>
      <title>Something went wrong · Apedia</title>
      <section className={styles.heroText}>
        <h1 className={styles.sectionTitle}>This page didn’t load.</h1>
        <p>It’s usually a passing hiccup. Nothing you’ve done is lost.</p>
        <div className={styles.ctaRow}>
          <button type="button" className="button-ink" onClick={() => retry()}>
            try again
          </button>
          <Link href="/" className={styles.example}>
            go home
          </Link>
        </div>
      </section>
    </main>
  );
}
