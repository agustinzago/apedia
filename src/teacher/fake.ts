import {
  InterviewReply,
  MissionDraft,
  SafetyVerdict,
  type InterviewFollowUpInput,
  type SafetyCheckInput,
  type Teacher,
  type WriteMissionInput,
} from "./contract";

/**
 * A Teacher that never calls Claude. Tests pass fixture JSON (see
 * `./fixtures`) for the replies they care about; anything left out gets a
 * predictable default. Every reply goes through the same zod schemas as the
 * real Teacher, so a fixture that the real one could not return fails loudly.
 *
 * It also stands in for the real Teacher in local development and the e2e
 * smoke test, where there is no API key.
 */

/** Fixture JSON, or a function of the input returning it. Validated when used. */
type Json = Record<string, unknown>;
type Reply<I> = Json | ((input: I) => Json);

export type FakeTeacherReplies = {
  checkSafety?: Reply<SafetyCheckInput>;
  interviewFollowUp?: Reply<InterviewFollowUpInput>;
  writeMission?: Reply<WriteMissionInput>;
};

export type FakeTeacherCall =
  | { op: "checkSafety"; input: SafetyCheckInput }
  | { op: "interviewFollowUp"; input: InterviewFollowUpInput }
  | { op: "writeMission"; input: WriteMissionInput };

export type FakeTeacher = Teacher & {
  /** Every call made, in order. */
  calls: FakeTeacherCall[];
};

export function createFakeTeacher(replies: FakeTeacherReplies = {}): FakeTeacher {
  const calls: FakeTeacherCall[] = [];
  const reply = <I>(given: Reply<I> | undefined, input: I, fallback: (input: I) => Json) =>
    given === undefined ? fallback(input) : typeof given === "function" ? given(input) : given;

  return {
    calls,

    async checkSafety(input) {
      calls.push({ op: "checkSafety", input });
      return SafetyVerdict.parse(
        reply(replies.checkSafety, input, () => ({
          verdict: "allow",
          language: "en",
          message: "",
        })),
      );
    },

    async interviewFollowUp(input) {
      calls.push({ op: "interviewFollowUp", input });
      return InterviewReply.parse(
        reply(replies.interviewFollowUp, input, (i) => ({
          followUp:
            i.mayFollowUp && i.answer.trim() === ""
              ? "Could you say a little more? Anything you can tell me helps."
              : null,
          nextQuestion: i.nextQuestion,
        })),
      );
    },

    async writeMission(input) {
      calls.push({ op: "writeMission", input });
      return MissionDraft.parse(
        reply(replies.writeMission, input, (i) => ({
          title: i.subject,
          why: i.why,
          successLooksLike: [i.success],
          constraints: [`${i.sittingMinutes} minutes per sitting`],
          outOfScope: [],
          priorKnowledge: { title: "What I knew at the start", body: i.know },
        })),
      );
    },
  };
}
