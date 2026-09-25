import { notFound } from "next/navigation";
import type { CoursePath, FinishedLesson, UpNextLesson } from "@/course";
import { loadCoursePath } from "@/server/course";
import styles from "./course.module.css";

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default async function PathTab({
  params,
}: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params;
  const course = await loadCoursePath(courseId);
  if (!course) notFound();

  return (
    <div className={styles.path}>
      <div className={styles.pathMain}>
        <MissionCard course={course} />
        <section aria-labelledby="lessons-heading">
          <h2 id="lessons-heading" className={styles.sectionTitle}>
            Lessons
          </h2>
          <ol className={styles.lessons}>
            {course.finishedLessons.map((lesson) => (
              <FinishedLessonItem key={lesson.index} lesson={lesson} />
            ))}
            {course.upNext && <UpNextItem lesson={course.upNext} />}
          </ol>
          {course.finishedLessons.length === 0 && !course.upNext && (
            <p className={styles.muted}>No Lessons yet.</p>
          )}
        </section>
      </div>
      <LearningRecords course={course} />
    </div>
  );
}

function MissionCard({ course }: { course: CoursePath }) {
  const { mission } = course;
  return (
    <section aria-labelledby="mission-heading" className={`sticky-note ${styles.mission}`}>
      <h2 id="mission-heading" className={`kicker ${styles.missionKicker}`}>
        Mission
      </h2>
      <p className={styles.missionWhy}>{mission.why}</p>
      <dl className={styles.missionFacts}>
        <dt>success looks like</dt>
        <dd>
          <List items={mission.success} />
        </dd>
        <dt>constraints</dt>
        <dd>
          <List items={mission.constraints} />
        </dd>
        <dt>out of scope</dt>
        <dd>
          <List items={mission.outOfScope} />
        </dd>
      </dl>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  if (items.length === 0) return <span className={styles.muted}>—</span>;
  return (
    <ul className={styles.factList}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function FinishedLessonItem({ lesson }: { lesson: FinishedLesson }) {
  return (
    <li className={styles.lesson}>
      <div className={styles.lessonRail} aria-hidden>
        <span className={`sketchy-circle ${styles.lessonMark} ${styles.lessonMarkDone}`}>
          ✓
        </span>
        <span className={styles.lessonLine} />
      </div>
      <div className={`sketchy ${styles.lessonCard}`}>
        <span className={styles.lessonMeta}>
          <span>
            Lesson {lesson.index} · finished {shortDate.format(lesson.finishedAt)}
          </span>
          <span className={styles.lessonScore}>
            quiz {lesson.score.correct}/{lesson.score.total}
          </span>
        </span>
        <span className={styles.lessonTitle}>{lesson.title}</span>
        <span className={styles.lessonGoal}>→ {lesson.goal}</span>
      </div>
    </li>
  );
}

function UpNextItem({ lesson }: { lesson: UpNextLesson }) {
  return (
    <li className={styles.lesson}>
      <div className={styles.lessonRail} aria-hidden>
        <span className={`sketchy-circle ${styles.lessonMark} ${styles.lessonMarkNext}`}>
          {lesson.index}
        </span>
      </div>
      <div className={`sketchy ${styles.lessonCard} ${styles.lessonCardNext}`}>
        <span className={styles.lessonMeta}>
          <span>
            Lesson {lesson.index}
            {lesson.started && " · started"}
          </span>
          <span className={styles.upNextLabel}>Up next</span>
        </span>
        <span className={styles.lessonTitle}>{lesson.title}</span>
        <span className={styles.lessonGoal}>→ {lesson.goal}</span>
      </div>
    </li>
  );
}

function LearningRecords({ course }: { course: CoursePath }) {
  const finished = course.finishedLessons.length;
  return (
    <aside aria-labelledby="records-heading" className={`sketchy-mirror ${styles.records}`}>
      <p className={styles.progress}>
        {finished === 0
          ? "No Lessons finished yet."
          : `${finished} ${finished === 1 ? "Lesson" : "Lessons"} finished`}
      </p>
      <h2 id="records-heading" className={`kicker ${styles.recordsKicker}`}>
        Learning records
      </h2>
      {course.learningRecords.length === 0 ? (
        <p className={styles.muted}>
          Finish a Lesson and what you learned is written here.
        </p>
      ) : (
        <ol className={styles.recordList}>
          {course.learningRecords.map((record) => (
            <li
              key={record.number}
              className={`${styles.record} ${record.superseded ? styles.recordSuperseded : ""}`}
            >
              <span className={styles.recordMeta}>
                <span className={styles.recordNumber}>
                  {String(record.number).padStart(4, "0")}
                </span>
                <span>{shortDate.format(record.createdAt)}</span>
              </span>
              <span className={styles.recordTitle}>{record.title}</span>
              <span className={styles.recordBody}>{record.body}</span>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
