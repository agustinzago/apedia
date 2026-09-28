import Link from "next/link";
import { EXAMPLE_COURSE_ID, type CourseSummary } from "@/course";
import { Mascot } from "@/components/mascot";
import { loadYourCourses } from "@/server/course";
import { SubjectForm } from "./subject-form";
import styles from "./home.module.css";

export default async function Home() {
  const yourCourses = await loadYourCourses();

  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <Mascot size={110} preload />
        <h1 className={styles.title}>
          What would you like to <span className="highlight">learn</span>?
        </h1>
        <p className={styles.lede}>
          Anything at all. Your teacher will ask you 4 short questions, then
          write a course that fits your reason and your time.
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
        <YourCourses courses={yourCourses} />
      </section>
    </main>
  );
}

function YourCourses({ courses }: { courses: CourseSummary[] | null }) {
  if (courses === null) {
    return (
      <p className={styles.empty}>
        <Link href="/sign-in">Sign in</Link> to keep your courses and come back
        to them.
      </p>
    );
  }
  if (courses.length === 0) {
    return <p className={styles.empty}>Courses you start will appear here.</p>;
  }
  return (
    <ul className={styles.courseList}>
      {courses.map((course) => (
        <li key={course.id}>
          <Link href={`/courses/${course.id}`} className={`sketchy ${styles.courseCard}`}>
            <span className={styles.courseSubject}>
              {course.subject}
              {course.status === "done" && (
                <span className={styles.courseDone}> · Done ✓</span>
              )}
            </span>
            <span className={styles.courseTitle}>{course.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
