"use client";

import "./globals.css";
import styles from "./home.module.css";

/** When the root layout itself fails, such as the header reading the database. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body>
        <title>Something went wrong · Apedia</title>
        <main className={styles.main}>
          <section className={styles.heroText}>
            <h1 className={styles.sectionTitle}>Apedia didn’t load.</h1>
            <p>It’s usually a passing hiccup. Nothing you’ve done is lost.</p>
            <div className={styles.ctaRow}>
              <button type="button" className="button-ink" onClick={() => retry()}>
                try again
              </button>
              {/* A full load: the root layout this replaces is what failed. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a href="/" className={styles.example}>
                go home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
