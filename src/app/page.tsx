import Link from "next/link";
import { EXAMPLE_COURSE_ID } from "@/course";
import { Mascot } from "@/components/mascot";
import { SubjectForm } from "./subject-form";
import styles from "./home.module.css";

export default function Home() {
  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <Mascot size={110} preload />
        <h1 className={styles.title}>
          What would you like to <span className="highlight">learn</span>?
        </h1>
        <p className={styles.lede}>
          Tell your teacher why it matters to you. You’ll get a short course
          built around that reason.
        </p>
        <SubjectForm />
        <Link href={`/courses/${EXAMPLE_COURSE_ID}`} className={styles.example}>
          or open the Example course: Music theory
        </Link>
      </section>

      <section className={styles.yourCourses} aria-labelledby="your-courses">
        <h2 id="your-courses" className={styles.sectionTitle}>
          Your courses
        </h2>
        {/* Courses need sign-in, which lands in a later ticket; until then the list is always empty. */}
        <p className={styles.empty}>
          Courses you start will appear here.
        </p>
      </section>
    </main>
  );
}
