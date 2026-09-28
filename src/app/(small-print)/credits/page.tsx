import type { Metadata } from "next";
import { TEACH_SKILL_URL } from "@/components/site-footer";
import styles from "../small-print.module.css";

export const metadata: Metadata = { title: "Credits · Apedia" };

export default function CreditsPage() {
  return (
    <>
      <h1 className={styles.title}>
        <span className="highlight">Credits</span>
      </h1>
      <p className={styles.lede}>Apedia stands on other people’s work.</p>

      <section aria-labelledby="method" className={styles.section}>
        <h2 id="method" className={styles.sectionTitle}>
          The teaching method
        </h2>
        <p>
          Apedia runs Matt Pocock’s <a href={TEACH_SKILL_URL}>/teach</a>{" "}
          method: a Mission first, then one short Lesson at a time, each chosen
          from what you’ve shown you know, and Resources that have been checked
          to exist. It comes from his collection of{" "}
          <a href="https://github.com/mattpocock/skills">skills</a>.
        </p>
      </section>

      <section aria-labelledby="teacher" className={styles.section}>
        <h2 id="teacher" className={styles.sectionTitle}>
          The Teacher
        </h2>
        <p>The Teacher’s words are written by Claude, made by Anthropic.</p>
      </section>

      <section aria-labelledby="look" className={styles.section}>
        <h2 id="look" className={styles.sectionTitle}>
          The look
        </h2>
        <ul className={styles.list}>
          <li>
            Headings in <a href="https://fonts.google.com/specimen/Kalam">Kalam</a>, by
            Indian Type Foundry.
          </li>
          <li>
            Text in{" "}
            <a href="https://fonts.google.com/specimen/Patrick+Hand">Patrick Hand</a>, by
            Patrick Wagesreiter.
          </li>
          <li>
            Both fonts come from Google Fonts under the{" "}
            <a href="https://openfontlicense.org">SIL Open Font License</a>.
          </li>
          <li>
            The hand-drawn notebook is inspired by{" "}
            <a href="https://excalidraw.com">Excalidraw</a>.
          </li>
        </ul>
      </section>
    </>
  );
}
