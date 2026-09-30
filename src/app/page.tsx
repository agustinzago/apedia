import Link from "next/link";
import type { ReactNode } from "react";
import { COURSE_CREDIT, EXAMPLE_COURSE_CARDS, type CourseSummary, type ExampleCourseCard } from "@/course";
import { shortSubject } from "@/course/short-subject";
import { Mascot } from "@/components/mascot";
import { FORWARD } from "@/components/page-transition";
import { loadCourseCredits, loadInterviewStart, loadYourCourses } from "@/server/course";
import { openInterviewPath } from "./interview/subject";
import { BuyCourse } from "./purchase/buy-course";
import { creditsLine } from "./purchase/credits-line";
import styles from "./home.module.css";

/**
 * The landing page: what Apedia is, the Example courses to look inside for
 * free, and "Buy a Course". Buying leads to /start, where the Learner types
 * what they want to learn; a Learner already holding a Course credit goes
 * straight there.
 */
export default async function Home() {
  const [yourCourses, credits, start] = await Promise.all([
    loadYourCourses(),
    loadCourseCredits(),
    loadInterviewStart(),
  ]);
  const hasCredit = (start?.creditsToStart ?? 0) > 0;

  return (
    <main className={styles.main}>
      <section className={styles.hero}>
        <div className={styles.heroText}>
          <span className={`kicker ${styles.heroKicker}`}>A teacher for anything</span>
          <h1 className={styles.title}>
            Learn anything, your way, for <span className="highlight">your reasons</span>.
          </h1>
          <p className={styles.lede}>
            Tell your teacher what you want to learn and why. You get short
            Lessons that fit one sitting, sources that really exist, and a
            Reference sheet that grows as you go.
          </p>
          <div className={styles.ctaRow}>
            <StartOrBuy hasCredit={hasCredit} />
            <a href="#examples" className={styles.peek}>
              or look inside one first, free ↓
            </a>
          </div>
          <p className={styles.small}>
            One subject · up to {COURSE_CREDIT.lessons} Lessons · priced at cost
          </p>
        </div>
        <HeroSketch />
      </section>

      {start?.openInterviews.map((open) => (
        <Link key={open.id} href={openInterviewPath(open.id)} className={styles.openInterview}>
          Your Interview on {shortSubject(open.subject)} is waiting: continue it
        </Link>
      ))}

      {yourCourses !== null && (
        <section className={styles.section} aria-labelledby="your-courses">
          <div className={styles.sectionHead}>
            <h2 id="your-courses" className={styles.sectionTitle}>
              Your courses
            </h2>
            {credits !== null && (
              <p className={styles.creditCount}>
                {creditsLine(credits.available, start?.openInterviews.length)}
              </p>
            )}
          </div>
          <YourCourses courses={yourCourses} />
        </section>
      )}

      <section id="examples" className={styles.section} aria-labelledby="examples-heading">
        <div className={styles.sectionHead}>
          <div className={styles.sectionIntro}>
            <h2 id="examples-heading" className={styles.sectionTitle}>
              Look inside three real Courses
            </h2>
            <p className={styles.sectionLede}>
              Each one written for one person’s Mission. Open any of them: no
              sign-in, nothing to pay.
            </p>
          </div>
          <span className={styles.freeTag}>free · read-only</span>
        </div>
        <ul className={styles.exampleList}>
          {EXAMPLE_COURSE_CARDS.map((card, i) => (
            <li key={card.id}>
              <ExampleCard card={card} mirror={i % 2 === 1} />
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section} aria-labelledby="how-heading">
        <h2 id="how-heading" className={styles.sectionTitle}>
          How your own Course works
        </h2>
        <ol className={styles.steps}>
          <Step n={1} title="Buy a Course">
            ${COURSE_CREDIT.priceUsd}, once. One subject, as far as your Mission
            takes it. No subscription.
          </Step>
          <Step n={2} title="Tell your teacher why">
            Four short questions: your reason, what you know, what success
            looks like, and how long you can sit.
          </Step>
          <Step n={3} title="Learn one sitting at a time">
            Each Lesson gives you one real win and a quiz, and the next Lesson
            is written before you get to it.
          </Step>
        </ol>
      </section>

      <section className={`sketchy-mirror ${styles.buy}`} aria-labelledby="buy-heading">
        <div className={styles.buyText}>
          <h2 id="buy-heading" className={styles.buyTitle}>
            Start your own Course ·{" "}
            <span className="highlight">${COURSE_CREDIT.priceUsd}</span>
          </h2>
          <p className={styles.sectionLede}>
            Priced at cost: Apedia doesn’t aim to profit. Tax may be added at
            checkout. Not started? A full refund within{" "}
            {COURSE_CREDIT.refundDays} days.
          </p>
          <div className={styles.ctaRow}>
            <StartOrBuy hasCredit={hasCredit} />
            <Link href="/pricing" className={styles.peek}>
              What a Course includes
            </Link>
          </div>
        </div>
        <ul className={styles.includes}>
          <li>The Interview and your written Mission</li>
          <li>Up to {COURSE_CREDIT.lessons} Lessons, each with a quiz</li>
          <li>{COURSE_CREDIT.chatQuestions} questions to your teacher</li>
          <li>Resources checked to really exist</li>
          <li>A printable Reference sheet</li>
        </ul>
      </section>
    </main>
  );
}

/** With a Course credit to use, straight to choosing a subject; otherwise, buy one. */
function StartOrBuy({ hasCredit }: { hasCredit: boolean }) {
  if (hasCredit) {
    return (
      <Link href="/start" transitionTypes={FORWARD} className="button-ink">
        Start a Course
      </Link>
    );
  }
  return <BuyCourse from="/start" />;
}

/** The Interview and a Mission, as sticky notes: what the Teacher does first. */
function HeroSketch() {
  return (
    <div className={styles.sketch} aria-hidden>
      <div className={`sketchy ${styles.sketchChat}`}>
        <div className={styles.sketchTeacher}>
          <Mascot size={62} preload />
          <span className={styles.sketchWho}>
            <span className={styles.sketchName}>Your teacher</span>
            <span className={styles.sketchStep}>the Interview, question 1 of 4</span>
          </span>
        </div>
        <p className={styles.sketchAsk}>Why do you want to learn vegetable gardening?</p>
        <p className={styles.sketchAnswer}>
          I want salad from my own garden instead of buying it every week.
        </p>
      </div>
      <div className={`sticky-note ${styles.sketchMission}`}>
        <span className={`kicker ${styles.sketchKicker}`}>Mission</span>
        <span className={styles.sketchMissionText}>
          Pick the first salad from a 2 m bed you made yourself.
        </span>
        <span className={styles.sketchStep}>15 minutes a sitting · hand tools only</span>
      </div>
    </div>
  );
}

/** The look of each Example course's card, by its subject. */
const CARD_LOOKS: Record<string, { tone: string; icon: ReactNode }> = {
  "example-music-theory": {
    tone: styles.toneBlue,
    icon: (
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>
    ),
  },
  "example-vegetable-garden": {
    tone: styles.toneGreen,
    icon: (
      <>
        <path d="M12 21v-9" />
        <path d="M12 12C12 8 9 5 4 5c0 5 3 7 8 7z" />
        <path d="M12 14c0-4 3-7 8-7 0 5-3 7-8 7z" />
        <path d="M5 21h14" />
      </>
    ),
  },
  "example-phone-photography": {
    tone: styles.toneYellow,
    icon: (
      <>
        <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
  },
};

function ExampleCard({ card, mirror }: { card: ExampleCourseCard; mirror: boolean }) {
  const look = CARD_LOOKS[card.id] ?? { tone: styles.toneBlue, icon: null };
  const finished = card.lessons.filter((l) => l.finished).length;

  return (
    <Link
      href={`/courses/${card.id}`}
      transitionTypes={FORWARD}
      className={`${mirror ? "sketchy-mirror" : "sketchy"} ${styles.exampleCard} ${look.tone}`}
    >
      <span className={styles.exampleArt} aria-hidden>
        <svg
          width="60"
          height="60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {look.icon}
        </svg>
      </span>
      <span className={styles.exampleBody}>
        <span className={`kicker ${styles.exampleSubject}`}>{card.subject}</span>
        <span className={styles.exampleTitle}>{card.title}</span>
        <span className={styles.exampleWhy}>“{card.why}”</span>
        <span className={styles.exampleLessons}>
          {card.lessons.map((l) => (
            <span key={l.index} className={styles.exampleLesson} data-finished={l.finished}>
              <span aria-hidden>{l.finished ? "✓" : "→"}</span> {l.title}
            </span>
          ))}
        </span>
        <span className={styles.exampleMeta}>
          {finished} of {card.lessons.length} Lessons finished · {card.sittingMinutes}-minute
          sittings · {card.resources} Resources
        </span>
        <span className={styles.exampleOpen}>Open the course →</span>
      </span>
    </Link>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className={styles.step}>
      <span className={`sketchy-circle ${styles.stepNumber}`} aria-hidden>
        {n}
      </span>
      <h3 className={styles.stepTitle}>{title}</h3>
      <p className={styles.stepText}>{children}</p>
    </li>
  );
}

function YourCourses({ courses }: { courses: CourseSummary[] }) {
  if (courses.length === 0) {
    return <p className={styles.empty}>Courses you start will appear here.</p>;
  }
  return (
    <ul className={styles.courseList}>
      {courses.map((course) => (
        <li key={course.id}>
          <Link
            href={`/courses/${course.id}`}
            transitionTypes={FORWARD}
            className={`sketchy ${styles.courseCard}`}
          >
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
