import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { openingMessages } from "@/course";
import { getViewer } from "@/server/auth";
import { loadInterview } from "@/server/interview";
import { InterviewChat } from "./interview-chat";

export const metadata: Metadata = { title: "Interview · Apedia" };

/**
 * The Interview: `?subject=` starts a new one (it is stored once the first
 * question is answered); without it, this browser's Interview is resumed,
 * for example on returning from sign-in.
 */
export default async function InterviewPage({ searchParams }: PageProps<"/interview">) {
  const [{ subject }, viewer] = await Promise.all([searchParams, getViewer()]);
  const signedIn = viewer.learnerId !== null;

  const typed = typeof subject === "string" ? subject.trim().slice(0, 120) : "";
  if (typed) {
    return (
      <InterviewChat
        key={`new:${typed}`}
        subject={typed}
        openingMessages={openingMessages(typed)}
        initial={null}
        signedIn={signedIn}
      />
    );
  }

  const view = await loadInterview();
  if (!view) redirect("/");
  if (view.courseId) redirect(`/courses/${view.courseId}`);
  return (
    <InterviewChat
      key={view.id}
      subject={view.subject}
      openingMessages={view.messages}
      initial={view}
      signedIn={signedIn}
    />
  );
}
