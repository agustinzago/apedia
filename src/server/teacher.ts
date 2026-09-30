import { createClaudeTeacher, type Teacher, type TeacherCallRecorder } from "@/teacher";
import { createFakeTeacher } from "@/teacher/fake";
import { createUrlFetcher, type UrlFetcher } from "@/url-fetcher";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";

/**
 * The app's Teacher: Claude when ANTHROPIC_API_KEY is set. Outside production
 * (and in the e2e smoke test, via APEDIA_FAKE_TEACHER=1, which Vercel's
 * Production ignores) it falls back to the fake Teacher so the app runs
 * without a key.
 *
 * The choice is made on the first call, not at startup: in production without
 * a key only what needs the Teacher (the Interview) fails; the rest of the
 * site keeps working.
 *
 * Claude's calls, and only Claude's, go to `recordCall`: the stand-in's cost nothing.
 */
export function createAppTeacher({
  recordCall,
}: { recordCall?: TeacherCallRecorder } = {}): Teacher {
  let teacher: Teacher | undefined;
  const get = () => (teacher ??= chooseTeacher(recordCall));
  return {
    checkSafety: async (input) => get().checkSafety(input),
    interviewFollowUp: async (input) => get().interviewFollowUp(input),
    writeMission: async (input) => get().writeMission(input),
    researchSearch: async (input) => get().researchSearch(input),
    researchStructure: async (input) => get().researchStructure(input),
    pickUpNext: async (input) => get().pickUpNext(input),
    writeLesson: async (input) => get().writeLesson(input),
    rewriteQuestion: async (input) => get().rewriteQuestion(input),
    finishLesson: async (input) => get().finishLesson(input),
    askTeacher: async (input) => get().askTeacher(input),
  };
}

/**
 * The app's URL fetcher: the real one, except alongside the stand-in Teacher,
 * whose made-up Resources would all fail a real check.
 */
export function createAppUrlFetcher(): UrlFetcher {
  let fetcher: UrlFetcher | undefined;
  return async (url) => {
    fetcher ??= usesStandInTeacher() ? createFakeUrlFetcher() : createUrlFetcher();
    return fetcher(url);
  };
}

/**
 * APEDIA_FAKE_TEACHER=1, honoured everywhere but Vercel's Production, where a
 * stray flag would hand paying Learners the stand-in.
 */
function fakeTeacherAsked(): boolean {
  if (process.env.APEDIA_FAKE_TEACHER !== "1") return false;
  if (process.env.VERCEL_ENV !== "production") return true;
  console.error("APEDIA_FAKE_TEACHER is ignored in production.");
  return false;
}

function usesStandInTeacher(): boolean {
  if (fakeTeacherAsked()) return true;
  return !process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== "production";
}

function chooseTeacher(recordCall: TeacherCallRecorder | undefined): Teacher {
  if (fakeTeacherAsked()) return createFakeTeacher();
  if (process.env.ANTHROPIC_API_KEY) return createClaudeTeacher({ recordCall });
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "ANTHROPIC_API_KEY is not set: the Teacher is a stand-in that echoes your answers.",
    );
    return createFakeTeacher();
  }
  throw new Error("ANTHROPIC_API_KEY is not set.");
}
