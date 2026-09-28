import {
  ChatAnswer,
  FinishDraft,
  InterviewReply,
  LessonDraft,
  MissionDraft,
  QuestionDraft,
  ResearchDraft,
  SafetyVerdict,
  SearchFindings,
  UpNextDraft,
  type AskTeacherInput,
  type FinishLessonInput,
  type InterviewFollowUpInput,
  type PickUpNextInput,
  type ResearchSearchInput,
  type ResearchStructureInput,
  type RewriteQuestionInput,
  type SafetyCheckInput,
  type Teacher,
  type WriteLessonInput,
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
  writeLesson?: Reply<WriteLessonInput>;
  rewriteQuestion?: Reply<RewriteQuestionInput>;
  finishLesson?: Reply<FinishLessonInput>;
  askTeacher?: Reply<AskTeacherInput>;
};

export type FakeTeacherCall =
  | { op: "checkSafety"; input: SafetyCheckInput }
  | { op: "interviewFollowUp"; input: InterviewFollowUpInput }
  | { op: "writeMission"; input: WriteMissionInput }
  | { op: "researchSearch"; input: ResearchSearchInput }
  | { op: "researchStructure"; input: ResearchStructureInput }
  | { op: "pickUpNext"; input: PickUpNextInput }
  | { op: "writeLesson"; input: WriteLessonInput }
  | { op: "rewriteQuestion"; input: RewriteQuestionInput }
  | { op: "finishLesson"; input: FinishLessonInput }
  | { op: "askTeacher"; input: AskTeacherInput };

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

    async writeLesson(input) {
      calls.push({ op: "writeLesson", input });
      return LessonDraft.parse(reply(replies.writeLesson, input, defaultLesson));
    },

    async rewriteQuestion(input) {
      calls.push({ op: "rewriteQuestion", input });
      return QuestionDraft.parse(
        reply(replies.rewriteQuestion, input, (i) => ({
          ...i.question,
          options: ["The first choice", "The second choice", "The third choice", "The fourth choice"],
        })),
      );
    },

    async finishLesson(input) {
      calls.push({ op: "finishLesson", input });
      return FinishDraft.parse(reply(replies.finishLesson, input, defaultFinish));
    },

    async askTeacher(input) {
      calls.push({ op: "askTeacher", input });
      return ChatAnswer.parse(
        reply(replies.askTeacher, input, (i) => {
          const [first] = i.lesson.sections.flatMap((s) => s.citations);
          return {
            answer: `Good question. Look again at “${i.lesson.sections[0]?.heading ?? i.lesson.title}”: ${i.lesson.keyIdea}${first ? ` [${first}]` : ""}`,
            community: null,
          };
        }),
      );
    },
  };
}

/**
 * A Finish that writes no Learning record, offers each new term with the
 * question of the same number, and moves on to a numbered next step.
 */
function defaultFinish(input: FinishLessonInput): Json {
  const next = input.lesson.index + 1;
  return {
    learningRecords: [],
    glossary: input.lesson.newTerms.map((t, i) => ({ term: t.term, question: i + 1 })),
    referenceSections: [],
    upNext: {
      title: `Step ${next} in ${input.subject}`.split(/\s+/).slice(0, 6).join(" "),
      goal: `Use what Lesson ${input.lesson.index} taught on something of your own`,
      minutes: input.mission.sittingMinutes,
    },
  };
}

/** A Lesson that keeps every rule, citing the first Resources it is given. */
function defaultLesson(input: WriteLessonInput): Json {
  const [first, second = first] = input.resources.map((r) => r.id);
  const question = (n: number, about: string) => ({
    question: `Question ${n}: which statement fits ${about}?`,
    options: ["The first statement", "The second statement", "The third statement", "The fourth statement"],
    answer: 0,
    explanation: "The first statement is the one this Lesson taught.",
  });
  return {
    hook: `This is the next step toward your Mission: ${input.mission.why}`,
    sections: [
      {
        heading: "The idea",
        body: `${input.lesson.title}. This section explains the idea behind the goal in plain words, one step at a time, so it makes sense on its own.`,
        citations: [first],
      },
      {
        heading: "Seeing it work",
        body: "This section shows the idea at work in a short example you can follow along with, then says what to notice.",
        citations: [second],
      },
    ],
    keyIdea: `${input.lesson.goal}.`,
    practice: {
      title: "Try it yourself",
      steps: ["Read the example again.", "Do it once on your own.", "Check what you did against the example."],
    },
    practiceMinutes: Math.max(1, input.mission.sittingMinutes - 2),
    quiz: [
      question(1, "the idea"),
      question(2, "the example"),
      question(3, input.keyIdeas.length > 0 ? "an earlier Lesson" : "the practice"),
    ],
    readNext: first,
    newTerms: [],
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
