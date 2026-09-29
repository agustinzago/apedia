import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MAX_QUESTION_LENGTH, type LessonResource, type LessonSection, type LessonView } from "@/course";
import { loadLesson } from "@/server/course";
import { AskTeacher } from "./ask-teacher";
import { FinishButton } from "./finish-button";
import { LessonGeneration } from "./lesson-generation";
import { Quiz } from "./quiz";
import styles from "./lesson.module.css";

const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

async function lessonFromParams(
  params: PageProps<"/courses/[courseId]/lessons/[index]">["params"],
) {
  const { courseId, index } = await params;
  if (!/^[1-9]\d*$/.test(index)) return null;
  return loadLesson(courseId, Number(index));
}

export async function generateMetadata({
  params,
}: PageProps<"/courses/[courseId]/lessons/[index]">): Promise<Metadata> {
  const lesson = await lessonFromParams(params);
  return lesson ? { title: `${lesson.title} · Apedia` } : {};
}

export default async function LessonPage({
  params,
}: PageProps<"/courses/[courseId]/lessons/[index]">) {
  const lesson = await lessonFromParams(params);
  if (!lesson) notFound();
  const { content } = lesson;

  return (
    <main className={styles.main}>
      <Link
        data-noprint
        href={`/courses/${lesson.course.id}`}
        className={styles.back}
      >
        ← learning path
      </Link>

      <header className={styles.heading}>
        <span className={styles.meta}>
          <span>
            Lesson {lesson.index}
            {content && ` · about ${content.minutes} min`}
          </span>
          {lesson.course.isExample && (
            <span className={styles.exampleTag}>
              Example course · read-only
            </span>
          )}
        </span>
        <h1 className={styles.title}>{lesson.title}</h1>
        <p className={styles.goal}>→ {lesson.goal}</p>
      </header>

      {content ? (
        <>
          <p className={styles.hook}>
            <span className={styles.hookMark}>{content.hook}</span>
          </p>

          {content.sections.map((section) => (
            <Section key={section.heading} section={section} />
          ))}

          {content.newTerms.length > 0 && (
            <section
              aria-labelledby="new-words-heading"
              className={styles.words}
            >
              <h2 id="new-words-heading" className={`kicker ${styles.wordsKicker}`}>
                New words
              </h2>
              <dl className={styles.wordList}>
                {content.newTerms.map((t) => (
                  <div key={t.term}>
                    <dt className={styles.term}>{t.term}</dt>
                    <dd className={styles.definition}>{t.definition}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <section
            aria-labelledby="remember-heading"
            className={`sketchy-mirror ${styles.remember}`}
          >
            <h2 id="remember-heading" className={`kicker ${styles.rememberKicker}`}>
              Remember
            </h2>
            <p className={styles.keyIdea}>{content.keyIdea}</p>
          </section>

          <section aria-labelledby="practice-heading" className={styles.block}>
            <h2 id="practice-heading" className={styles.sectionTitle}>
              Practice: {content.practice.title}
            </h2>
            <ol className={styles.steps}>
              {content.practice.steps.map((step) => (
                <li key={step} className={styles.step}>
                  <span className={styles.box} aria-hidden />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </section>

          <Quiz
            courseId={lesson.course.id}
            lessonIndex={lesson.index}
            questions={content.quiz}
            answers={lesson.answers}
            finished={lesson.finishedAt !== null}
            // A Done Course's quiz can be tried again, but nothing is saved.
            readOnly={lesson.readOnly || lesson.course.done}
          />

          <div className={styles.end}>
            {content.readNext && <ReadNext resource={content.readNext} />}
            <AskTeacher
              courseId={lesson.course.id}
              lessonIndex={lesson.index}
              initial={lesson.chat}
              proposals={lesson.proposals}
              maxLength={MAX_QUESTION_LENGTH}
              questionsLeft={lesson.questionsLeft}
              closedNote={
                lesson.readOnly
                  ? "This is a sample course, so the chat is off. Start your own course to ask your teacher."
                  : lesson.finishedAt
                    ? "This Lesson is finished, so its chat is closed."
                    : lesson.course.done
                      ? "This Course is Done, so its chat is closed."
                      : null
              }
            />
          </div>

          <FinishBar lesson={lesson} />
        </>
      ) : lesson.course.done ? (
        <p className={styles.unwritten}>
          This Course is Done, so this Lesson won’t be written.
        </p>
      ) : lesson.readOnly || lesson.finishedAt ? (
        <p className={styles.unwritten}>
          This Lesson hasn’t been written yet.
        </p>
      ) : (
        <LessonGeneration
          courseId={lesson.course.id}
          index={lesson.index}
          initial={lesson.generation}
        />
      )}
    </main>
  );
}

function Section({ section }: { section: LessonSection }) {
  return (
    <section className={styles.block}>
      <h2 className={styles.sectionTitle}>{section.heading}</h2>
      <p className={styles.body}>
        {section.body}
        {section.citations.map((r) => (
          <sup key={r.number} className={styles.cite}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              title={r.title}
              aria-label={`Source ${r.number}: ${r.title}`}
            >
              [{r.number}]
            </a>
          </sup>
        ))}
      </p>
    </section>
  );
}

function ReadNext({ resource }: { resource: LessonResource }) {
  return (
    <section
      aria-labelledby="read-next-heading"
      className={`sticky-note ${styles.readNext}`}
    >
      <h2 id="read-next-heading" className={`kicker ${styles.readNextKicker}`}>
        Read next
      </h2>
      <span className={styles.readNextTitle}>{resource.title}</span>
      <span className={styles.readNextMeta}>
        {resource.author} · {resource.kind}
      </span>
      <span className={styles.readNextWhy}>{resource.why}</span>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.readNextLink}
      >
        find it ↗
      </a>
    </section>
  );
}

function FinishBar({ lesson }: { lesson: LessonView }) {
  const total = lesson.content?.quiz.length ?? 0;
  const answered = lesson.answers.length;
  const allAnswered = answered >= total;
  const note = lesson.finishedAt
    ? `Finished on ${shortDate.format(lesson.finishedAt)}.`
    : lesson.readOnly
      ? "This is a sample course, so nothing is saved and Finish is off."
      : lesson.course.done
        ? "This Course is Done, so nothing is saved and Finish is off."
        : allAnswered
          ? "Every question answered."
          : `Answer every question to finish (${answered}/${total}).`;

  if (lesson.finishedAt) {
    return (
      <div data-noprint className={styles.finish}>
        <span className={styles.finishNote}>{note}</span>
        <button type="button" className="button-ink" disabled>
          Finished ✓
        </button>
      </div>
    );
  }
  return (
    <FinishButton
      courseId={lesson.course.id}
      index={lesson.index}
      enabled={!lesson.readOnly && !lesson.course.done && allAnswered}
      note={note}
      initial={lesson.finishing}
    />
  );
}
