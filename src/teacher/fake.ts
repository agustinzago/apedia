import {
  InterviewReply,
  MissionDraft,
  ResearchDraft,
  SafetyVerdict,
  SearchFindings,
  UpNextDraft,
  type InterviewFollowUpInput,
  type PickUpNextInput,
  type ResearchSearchInput,
  type ResearchStructureInput,
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

/** Fixture JSON, or a function of the input returning it (a thrown error fails the call). Validated when used. */
type Json = Record<string, unknown>;
type Reply<I> = Json | ((input: I) => Json);

export type FakeTeacherReplies = {
  checkSafety?: Reply<SafetyCheckInput>;
  interviewFollowUp?: Reply<InterviewFollowUpInput>;
  writeMission?: Reply<WriteMissionInput>;
  researchSearch?: Reply<ResearchSearchInput>;
  researchStructure?: Reply<ResearchStructureInput>;
  pickUpNext?: Reply<PickUpNextInput>;
};

export type FakeTeacherCall =
  | { op: "checkSafety"; input: SafetyCheckInput }
  | { op: "interviewFollowUp"; input: InterviewFollowUpInput }
  | { op: "writeMission"; input: WriteMissionInput }
  | { op: "researchSearch"; input: ResearchSearchInput }
  | { op: "researchStructure"; input: ResearchStructureInput }
  | { op: "pickUpNext"; input: PickUpNextInput };

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

    async researchSearch(input) {
      calls.push({ op: "researchSearch", input });
      return SearchFindings.parse(
        reply(replies.researchSearch, input, (i) => ({
          text: `Candidates for ${i.subject}.`,
          results: defaultResources(i.subject).map(({ url, title }) => ({ url, title })),
        })),
      );
    },

    async researchStructure(input) {
      calls.push({ op: "researchStructure", input });
      return ResearchDraft.parse(
        reply(replies.researchStructure, input, (i) => ({
          resources: defaultResources(i.subject),
          communities: [
            {
              name: `${i.subject} learners`,
              where: "An online forum",
              url: "https://example.org/community",
              why: "Friendly people who answer beginners’ questions.",
              offline: false,
            },
            {
              name: "A local club",
              where: "A library or community centre near you",
              url: null,
              why: "Practise face to face.",
              offline: true,
            },
          ],
          gaps: [],
        })),
      );
    },

    async pickUpNext(input) {
      calls.push({ op: "pickUpNext", input });
      return UpNextDraft.parse(
        reply(replies.pickUpNext, input, (i) => ({
          title: `First steps in ${i.subject}`.split(/\s+/).slice(0, 6).join(" "),
          goal: `Name the first idea you need for: ${i.mission.successLooksLike[0] ?? i.subject}`,
          minutes: i.mission.sittingMinutes,
        })),
      );
    },
  };
}

/** What the stand-in Teacher "finds": pages on example.org, one per kind. */
function defaultResources(subject: string) {
  const slug = encodeURIComponent(subject.toLowerCase().replace(/\s+/g, "-"));
  return (["site", "docs", "course", "article", "site"] as const).map((kind, i) => ({
    kind,
    title: `${subject}: ${kind} ${i + 1}`,
    author: "Example author",
    url: `https://example.org/${slug}/${i + 1}`,
    why: `A trustworthy ${kind} on ${subject}.`,
    language: "en",
  }));
}
