import styles from "./coming-soon.module.css";

/** Placeholder for a Course tab whose content lands in a later ticket. */
export function ComingSoon({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{children}</p>
    </section>
  );
}
