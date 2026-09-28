import { createClaudeTeacher, type Teacher } from "@/teacher";
import { createFakeTeacher } from "@/teacher/fake";
import { createUrlFetcher, type UrlFetcher } from "@/url-fetcher";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";

/**
 * The app's Teacher: Claude when ANTHROPIC_API_KEY is set. Outside production
 * (and in the e2e smoke test, via APEDIA_FAKE_TEACHER=1) it falls back to the
 * fake Teacher so the app runs without a key.
 *
 * The choice is made on the first call, not at startup: in production without
 * a key only what needs the Teacher (the Interview) fails; the rest of the
 * site keeps working.
 */
export function createAppTeacher(): Teacher {
  let teacher: Teacher | undefined;
  const get = () => (teacher ??= chooseTeacher());
  return {
    checkSafety: async (input) => get().checkSafety(input),
    interviewFollowUp: async (input) => get().interviewFollowUp(input),
    writeMission: async (input) => get().writeMission(input),
    researchSearch: async (input) => get().researchSearch(input),
    researchStructure: async (input) => get().researchStructure(input),
    pickUpNext: async (input) => get().pickUpNext(input),
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

function usesStandInTeacher(): boolean {
  if (process.env.APEDIA_FAKE_TEACHER === "1") return true;
  return !process.env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== "production";
}

function chooseTeacher(): Teacher {
  if (process.env.APEDIA_FAKE_TEACHER === "1") return createFakeTeacher();
  if (process.env.ANTHROPIC_API_KEY) return createClaudeTeacher();
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "ANTHROPIC_API_KEY is not set: the Teacher is a stand-in that echoes your answers.",
    );
    return createFakeTeacher();
  }
  throw new Error("ANTHROPIC_API_KEY is not set.");
}
