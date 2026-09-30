import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { COURSE_CREDIT, openingMessages, type OpenInterview } from "@/course";
import { shortSubject } from "@/course/short-subject";
import { BuyCourse } from "@/app/purchase/buy-course";
import { ConfirmDelete } from "@/components/confirm-delete";
import { Mascot } from "@/components/mascot";
import { getViewer } from "@/server/auth";
import { getCourse, loadInterviewStart } from "@/server/course";
import { startOverOn } from "./actions";
import { InterviewChat } from "./interview-chat";
import { interviewPath, openInterviewPath, typedSubject } from "./subject";
import purchase from "../purchase/purchase.module.css";
import styles from "./interview.module.css";

export const metadata: Metadata = { title: "Interview · Apedia" };

/**
 * The Interview, for a signed-in Learner with a Course credit (ADR 0007).
 * `?subject=` starts a new one (stored once the first question is
 * answered); `?id=` comes back to one under way. A visitor signs in first,
 * and a Learner with no credit free buys a Course first; both come back
 * here with the subject they typed.
 */
export default async function InterviewPage({ searchParams }: PageProps<"/interview">) {
  const [params, viewer] = await Promise.all([searchParams, getViewer()]);
  const subject = typedSubject(params.subject);
  const interviewId = typeof params.id === "string" ? params.id : null;

  if (viewer.learnerId === null) {
    if (!interviewId && !subject) redirect("/");
    const here = interviewId ? openInterviewPath(interviewId) : interviewPath(subject);
    redirect(`/sign-in?${new URLSearchParams({ next: here })}`);
  }

  if (interviewId) {
    const view = await (await getCourse()).readInterview(interviewId, viewer.learnerId);
    if (!view) redirect("/");
    if (view.courseId) redirect(`/courses/${view.courseId}`);
    return (
      <InterviewChat
        key={view.id}
        subject={view.subject}
        openingMessages={view.messages}
        initial={view}
      />
    );
  }

  const start = (await loadInterviewStart())!;
  if (!subject) {
    // Say, an old link: the newest Interview under way, if any.
    const [newest] = start.openInterviews;
    redirect(newest ? openInterviewPath(newest.id) : "/start");
  }

  if (start.creditsToStart > 0) {
    return (
      <InterviewChat
        key={`new:${subject}`}
        subject={subject}
        openingMessages={openingMessages(subject)}
        initial={null}
      />
    );
  }
  return <BuyFirst subject={subject} openInterviews={start.openInterviews} />;
}

/** No Course credit is free to back a new Interview: buy a Course, or come back to one under way. */
function BuyFirst({
  subject,
  openInterviews,
}: {
  subject: string;
  openInterviews: OpenInterview[];
}) {
  const [holding] = openInterviews;
  const wanted = shortSubject(subject);
  const held = holding && shortSubject(holding.subject);

  return (
    <main className={purchase.main}>
      <Mascot size={88} />
      <h1 className={purchase.title}>
        First, a <span className="highlight">Course</span>
      </h1>
      <p className={purchase.lede}>
        Your teacher is ready to ask you about {wanted}. A Course costs US$
        {COURSE_CREDIT.priceUsd}: the Interview, your Mission and up to{" "}
        {COURSE_CREDIT.lessons} Lessons written for you.
      </p>
      <BuyCourse from={interviewPath(subject)} />
      {holding && (
        <section className={`sticky-note ${styles.holding}`} aria-labelledby="holding">
          <h2 id="holding" className={styles.holdingTitle}>
            Your Interview on {held} is waiting
          </h2>
          <p>
            Your Course credit is keeping it for you. Come back to it, or let
            it go and use the credit for {wanted} instead.
          </p>
          <Link href={openInterviewPath(holding.id)} className="button-ink">
            Continue the Interview on {held}
          </Link>
          <ConfirmDelete
            label={`Start on ${wanted} instead`}
            warning={`Your answers about ${held} go for good, and its Course credit starts an Interview on ${wanted}.`}
            confirmLabel={`Yes, start on ${wanted}`}
            action={startOverOn.bind(null, holding.id, subject)}
          />
        </section>
      )}
      <Link href="/" className={purchase.small}>
        Back to the home page
      </Link>
    </main>
  );
}
