import Link from "next/link";
import { COURSE_CREDIT, EXAMPLE_COURSE_ID, type CourseSummary } from "@/course";
import { Mascot } from "@/components/mascot";
import { loadCourseCredits, loadInterviewStart, loadYourCourses } from "@/server/course";
import { openInterviewPath } from "./interview/subject";
import { BuyCourse } from "./purchase/buy-course";
import { creditsLine } from "./purchase/credits-line";
import { SubjectForm } from "./subject-form";
import styles from "./home.module.css";

export default async function Home() {
  const [yourCourses, credits, start] = await Promise.all([
    loadYourCourses(),
    loadCourseCredits(),
    loadInterviewStart(),
  ]);

  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <Mascot size={110} preload />
        <h1 className={styles.title}>
          What would you like to <span className="highlight">learn</span>?
        </h1>
        <p className={styles.lede}>Anything at all, taught around your reason for learning it.</p>
        <Link href={`/courses/${EXAMPLE_COURSE_ID}`} className={`sketchy ${styles.exampleCard}`}>
          <span className={styles.exampleLead}>See a real Course first, free</span>
          <span className={styles.exampleWhat}>
            Music theory, the Example course. No sign-in needed.
          </span>
        </Link>

        <section className={styles.start} aria-labelledby="start-your-own">
          <h2 id="start-your-own" className={styles.startTitle}>
            Start your own Course · ${COURSE_CREDIT.priceUsd}
          </h2>
          <p className={styles.startLine}>
            One subject. The Teacher interviews you about your Mission, then
            writes up to {COURSE_CREDIT.lessons} Lessons, each with verified
            Resources and a quiz, and a Reference sheet that grows as you go.
            It’s priced at cost, since Apedia doesn’t aim to profit.{" "}
            <Link href="/pricing">What a Course includes</Link>
          </p>
          <SubjectForm />
          {start?.openInterviews.map((open) => (
            <Link key={open.id} href={openInterviewPath(open.id)} className={styles.openInterview}>
              Your Interview on {open.subject} is waiting: continue it
            </Link>
          ))}
        </section>
      </section>

      <section className={styles.yourCourses} aria-labelledby="your-courses">
        <div className={styles.yourCoursesHead}>
          <h2 id="your-courses" className={styles.sectionTitle}>
            Your courses
          </h2>
          {credits !== null && (
            <div className={styles.credits}>
              <p className={styles.creditCount}>{creditsLine(credits.available)}</p>
              <BuyCourse from="/" />
            </div>
          )}
        </div>
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
