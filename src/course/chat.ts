import { and, asc, eq, max } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { claudeUnavailable, type AskTeacherInput, type ChatAnswer, type Teacher } from "@/teacher";
import type { ChatMessage, ChatPart, CommunityEntry, LessonResource } from ".";
import { missionOf } from "./course-creation";
import { LessonContent } from "./lesson-content";
import { lockLearner } from "./locks";
import { findOwnLessonIn } from "./lessons";
import { questionsLeft, QUESTIONS_USED_UP, type QuestionsUsedUp } from "./allowance";
import type { DailyCaps, DailyLimitReached } from "./limits";
import {
  insertProposal,
  missionChangeProblem,
  proposalContext,
  proposalView,
  proposedMission,
  type ProposalView,
} from "./proposals";
import type { Spend, SpendPaused } from "./spend";

/**
 * "Ask your teacher": a Lesson's chat. The Teacher answers from the Lesson
 * and the Course's Resources, citing them as "[r3]", which the chat shows as
 * numbered links. For a "wisdom" question or an uncertain answer it may
 * suggest a Community, unless the Learner said "Not for me". When the
 * Learner says their goal has changed, it may propose a Mission change, which
 * waits for their confirmation (see ./proposals). Each Lesson's messages are
 * saved, numbered, for Finish to weigh as evidence.
 */

/** The longest question the chat takes, in characters. */
export const MAX_QUESTION_LENGTH = 500;

export type AskTeacherResult =
  | {
      ok: true;
      /** The Learner's question and the Teacher's answer, as saved. */
      messages: ChatMessage[];
      /** A Mission change the answer proposes, waiting for the Learner; null for none. */
      proposal: ProposalView | null;
      /** The questions left to ask across the Course's Lessons, this one counted. */
      questionsLeft: number;
    }
  | {
      ok: false;
      reason:
        | "not-found"
        | "read-only"
        | "not-written"
        | "finished"
        /** The Course is Done: its Lessons stay readable, but the chat is closed. */
        | "done"
        | "invalid"
        /** The Teacher could not answer just now; nothing was saved. */
        | "unavailable";
    }
  /** The Learner has asked all the questions the Course's allowance holds; nothing was saved. */
  | QuestionsUsedUp
  /** The Learner has asked today's questions; nothing was saved. */
  | DailyLimitReached
  /** The Teacher is paused for the day; nothing was saved. */
  | SpendPaused;

type ChatRow = {
  number: number;
  from: "teacher" | "learner";
  text: string;
  community: CommunityEntry | null;
};

/** A Resource citation as the Teacher writes it: "[r3]", or "[r1, r3]". */
const CITATION = /\s*\[\s*(r\d+(?:\s*[,;]\s*r\d+)*)\s*\]/g;

/**
 * A message split into text and citations. Each cited id becomes its
 * Resource; an id the Course does not have is dropped, so ids never show.
 */
export function chatParts(text: string, resources: Map<string, LessonResource>): ChatPart[] {
  const parts: ChatPart[] = [];
  const addText = (t: string) => {
    if (t === "") return;
    const last = parts.at(-1);
    if (last && "text" in last) last.text += t;
    else parts.push({ text: t });
  };
  let at = 0;
  for (const match of text.matchAll(CITATION)) {
    addText(text.slice(at, match.index));
    at = match.index + match[0].length;
    const refs = new Set(match[1].split(/[,;]/).map((ref) => ref.trim()));
    for (const ref of refs) {
      const resource = resources.get(ref);
      if (resource) parts.push({ cite: resource });
    }
  }
  addText(text.slice(at));
  return parts;
}

/** A Lesson's chat as saved, oldest first. */
async function readChatRows(db: Db, lessonId: string): Promise<ChatRow[]> {
  const rows = await db
    .select({
      number: schema.chatMessage.number,
      from: schema.chatMessage.from,
      text: schema.chatMessage.text,
      community: {
        name: schema.community.name,
        where: schema.community.where,
        url: schema.community.url,
        why: schema.community.why,
        offline: schema.community.offline,
      },
    })
    .from(schema.chatMessage)
    .leftJoin(schema.community, eq(schema.community.id, schema.chatMessage.communityId))
    .where(eq(schema.chatMessage.lessonId, lessonId))
    .orderBy(asc(schema.chatMessage.number));
  return rows;
}

/** The Learner's words stay as typed; only the Teacher cites. */
const viewOf = (row: ChatRow, resources: Map<string, LessonResource>): ChatMessage => ({
  from: row.from,
  parts: row.from === "teacher" ? chatParts(row.text, resources) : [{ text: row.text }],
  community: row.community,
});

/**
 * The questions and answers before question `number` (by default, all of
 * them), less questions without an answer: one still being answered, or
 * one whose request died after saving it.
 */
function answeredBefore(rows: ChatRow[], number = Infinity): ChatRow[] {
  const numbers = new Set(rows.map((r) => r.number));
  return rows.filter(
    (r) => r.number < number && (r.from === "teacher" || numbers.has(r.number + 1)),
  );
}

/** A Lesson's chat as the Lesson page shows it, oldest first. */
export async function readChat(
  db: Db,
  lessonId: string,
  resources: Map<string, LessonResource>,
): Promise<ChatMessage[]> {
  return answeredBefore(await readChatRows(db, lessonId)).map((row) => viewOf(row, resources));
}

/** A Lesson's chat as Finish weighs it: "C1", "C2"… oldest first. */
export async function chatEvidence(
  db: Db,
  lessonId: string,
): Promise<{ id: string; from: "teacher" | "learner"; text: string }[]> {
  return answeredBefore(await readChatRows(db, lessonId)).map((m) => ({
    id: `C${m.number}`,
    from: m.from,
    text: m.text,
  }));
}

/**
 * The number a new question takes: a question is always odd and its answer
 * the next number, even while it is still being answered. So questions
 * sent at once each keep their answer right after them.
 */
function nextQuestionNumber(last: number): number {
  return last % 2 === 1 ? last + 2 : last + 1;
}

export function createChatOperations({
  db,
  teacher,
  readResourcesByRef,
  caps,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  caps: DailyCaps;
  spend: Spend;
  /** The Course's Resources by ref, numbered as the Lesson shows them. */
  readResourcesByRef: (courseId: string) => Promise<Map<string, LessonResource>>;
}) {
  /** A structured call that fails usually succeeds the second time. */
  async function answer(input: AskTeacherInput): Promise<ChatAnswer> {
    try {
      return await teacher.askTeacher(input);
    } catch (error) {
      console.warn("Answering a chat question failed; trying once more.", error);
      return teacher.askTeacher(input);
    }
  }

  return {
    /**
     * The Learner asks a question in a Lesson's chat, within the Course's
     * allowance, their daily limit and the spend stop. The question is saved,
     * and counts, before the Teacher is asked; the answer once it comes. If
     * Claude was unavailable, the question is taken back. A reply Claude
     * wrote but that could not be used (cut off, malformed, empty) was paid
     * for, so the question still counts, unanswered: otherwise a question
     * built to break the reply could be asked again and again for free.
     */
    async askTeacher(
      courseId: string,
      lessonIndex: number,
      question: string,
      learnerId: string,
    ): Promise<AskTeacherResult> {
      const found = await findOwnLessonIn(db, courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const { lesson } = found;
      if (lesson.content === null) return { ok: false, reason: "not-written" };
      if (lesson.finishedAt !== null) return { ok: false, reason: "finished" };
      if (found.course.status === "done") return { ok: false, reason: "done" };
      const asked = question.trim();
      if (asked === "" || asked.length > MAX_QUESTION_LENGTH) {
        return { ok: false, reason: "invalid" };
      }
      const content = LessonContent.parse(lesson.content);
      const paused = await spend.teacherCall();
      if (paused) return paused;

      // The question counts from here, before the Teacher is asked, so
      // questions sent at once can't all pass the allowance and daily limit.
      const claimed = await db.transaction(async (tx) => {
        await lockLearner(tx, learnerId);
        const left = await questionsLeft(tx, lesson.courseId);
        if (left === 0) return QUESTIONS_USED_UP;
        const limited = await caps.chatMessage(learnerId, tx);
        if (limited) return limited;
        const [{ last }] = await tx
          .select({ last: max(schema.chatMessage.number) })
          .from(schema.chatMessage)
          .where(eq(schema.chatMessage.lessonId, lesson.id));
        const number = nextQuestionNumber(last ?? 0);
        await tx
          .insert(schema.chatMessage)
          .values({ lessonId: lesson.id, number, from: "learner", text: asked });
        return { number, left };
      });
      if ("reason" in claimed) return claimed;
      const { number: saved, left } = claimed;
      const takeBackQuestion = () =>
        db
          .delete(schema.chatMessage)
          .where(and(eq(schema.chatMessage.lessonId, lesson.id), eq(schema.chatMessage.number, saved)));

      const { course } = found;
      const [resources, communities, rows, resourcesByRef, proposals] = await Promise.all([
        db.select().from(schema.resource).where(eq(schema.resource.courseId, lesson.courseId)),
        db
          .select()
          .from(schema.community)
          .where(eq(schema.community.courseId, lesson.courseId))
          // As the Communities tab lists them: online first.
          .orderBy(asc(schema.community.offline), asc(schema.community.name)),
        readChatRows(db, lesson.id),
        readResourcesByRef(lesson.courseId),
        proposalContext(db, lesson.courseId),
      ]);
      // In the Teacher's order: r1, r2, … r10.
      resources.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
      const offered = course.communityOptOut ? [] : communities;
      const history = answeredBefore(rows, saved);

      let reply: ChatAnswer;
      try {
        reply = await answer({
          subject: course.subject,
          language: course.language,
          mission: missionOf(course),
          lesson: {
            index: lesson.index,
            title: lesson.title,
            goal: lesson.goal,
            hook: content.hook,
            sections: content.sections,
            keyIdea: content.keyIdea,
            practice: content.practice,
          },
          resources: resources.map((r) => ({
            id: r.ref,
            kind: r.kind,
            title: r.title,
            author: r.author,
            why: r.why,
          })),
          communities: offered.map((c, i) => ({
            number: i + 1,
            name: c.name,
            where: c.where,
            why: c.why,
            offline: c.offline,
          })),
          mayPointToCommunities: !course.communityOptOut,
          history: history.map((m) => ({ from: m.from, text: m.text })),
          proposals,
          question: asked,
        });
      } catch (error) {
        console.warn(`Lesson ${lesson.id}: the Teacher could not answer a chat question.`, error);
        if (claudeUnavailable(error)) await takeBackQuestion();
        return { ok: false, reason: "unavailable" };
      }
      const text = reply.answer.trim();
      if (text === "") {
        console.warn(`Lesson ${lesson.id}: the Teacher's chat answer was empty.`);
        return { ok: false, reason: "unavailable" };
      }
      // Only a Community the Learner has not opted out of, and one that exists.
      const community = reply.community === null ? null : (offered[reply.community - 1] ?? null);
      if (reply.community !== null && community === null) {
        console.warn(
          `Lesson ${lesson.id}: dropping the suggested Community ${reply.community}${course.communityOptOut ? ": the Learner opted out" : ": there is no such Community"}.`,
        );
      }

      let missionChange: ReturnType<typeof proposedMission> | null = null;
      if (reply.missionChange) {
        const problem = missionChangeProblem(reply.missionChange, missionOf(course));
        if (problem === null) missionChange = proposedMission(reply.missionChange);
        else console.warn(`Lesson ${lesson.id}: dropping the proposed Mission change: ${problem}`);
      }

      const proposal = await db.transaction(async (tx) => {
        await tx.insert(schema.chatMessage).values({
          lessonId: lesson.id,
          number: saved + 1,
          from: "teacher",
          text,
          communityId: community?.id ?? null,
        });
        return missionChange && reply.missionChange
          ? await insertProposal(tx, {
              courseId: course.id,
              lessonId: lesson.id,
              source: "chat",
              kind: "mission_change",
              reason: reply.missionChange.reason,
              mission: missionChange,
            })
          : null;
      });

      const entry = community && {
        name: community.name,
        where: community.where,
        url: community.url,
        why: community.why,
        offline: community.offline,
      };
      return {
        ok: true,
        messages: [
          viewOf({ number: saved, from: "learner", text: asked, community: null }, resourcesByRef),
          viewOf({ number: saved + 1, from: "teacher", text, community: entry }, resourcesByRef),
        ],
        proposal: proposal && proposalView(proposal, course, []),
        questionsLeft: left - 1,
      };
    },
  };
}
