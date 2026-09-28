import { and, asc, desc, eq, inArray, isNull, max, ne, notExists } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { DoneEvidence, ProposedMission } from "@/db/schema";
import type {
  DoneDraft,
  MissionChangeDraft,
  MissionInput,
  ProposalContext,
  Teacher,
  UpNextDraft,
} from "@/teacher";
import { upNextProblem } from "./course-creation";
import type { Tx } from "./jobs";
import { findLessonJob } from "./lessons";
import type { Spend, SpendPaused } from "./spend";

/**
 * Mission changes and Done (CONTEXT.md): the Teacher proposes, the Learner
 * decides. A proposal is raised at Finish or in a Lesson's chat and changes
 * nothing until the Learner confirms it. A confirmed Mission change rewrites
 * the Mission, writes a mission-change Learning record and re-picks an
 * unwritten Up next; a confirmed Done marks the Course Done, after which no
 * Lesson is written, answered or finished, but everything stays readable.
 */

type CourseRow = typeof schema.course.$inferSelect;
type ProposalRow = typeof schema.proposal.$inferSelect;
type RecordKind = (typeof schema.learningRecordKind.enumValues)[number];

/** A proposal waiting for the Learner's "confirm" or "not now". */
export type ProposalView =
  | {
      id: string;
      kind: "mission_change";
      /** Why the Teacher proposes it, in the Course's language. */
      reason: string;
      /** The Mission it would become. */
      mission: { why: string; success: string[]; constraints: string[]; outOfScope: string[] };
    }
  | {
      id: string;
      kind: "done";
      reason: string;
      /** Each success item with the Learning records that show it. */
      evidence: { successItem: string; records: { number: number; title: string }[] }[];
    };

export type DecideProposalResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not-found"
        /** The Learner already chose, or a newer proposal took its place. */
        | "decided"
        /** The Teacher could not re-pick Up next just now; nothing changed. */
        | "unavailable";
    }
  /** Re-picking Up next waits while the Teacher is paused for the day; nothing changed. */
  | SpendPaused;

/** Records a Done suggestion may rest on: what the Learner showed in the Course. */
const EVIDENCE_KINDS: ReadonlySet<RecordKind> = new Set(["understanding", "misconception"]);

/** How Mission text is compared: case and spacing aside. */
const keyOf = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase();
const tidyList = (items: string[]) => items.map((i) => i.trim()).filter((i) => i !== "");

/** The Mission change, tidied, as it is stored until the Learner decides. */
export function proposedMission(draft: MissionChangeDraft): ProposedMission {
  return {
    why: draft.why.trim(),
    success: tidyList(draft.successLooksLike),
    constraints: tidyList(draft.constraints),
    outOfScope: tidyList(draft.outOfScope),
    record: { title: draft.recordTitle.trim(), body: draft.recordBody.trim() },
  };
}

/** Why a proposed Mission change cannot be offered, or null if it can. */
export function missionChangeProblem(
  draft: MissionChangeDraft,
  current: MissionInput,
): string | null {
  const next = proposedMission(draft);
  if (draft.reason.trim() === "") return "it gives the Learner no reason.";
  if (next.why === "") return "the new Mission has no why.";
  if (next.success.length === 0) return "the new Mission has no success items.";
  if (next.record.title === "" || next.record.body === "") {
    return "it has no Learning record to write.";
  }
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((item, i) => keyOf(item) === keyOf(b[i]));
  if (
    keyOf(next.why) === keyOf(current.why) &&
    same(next.success, current.successLooksLike) &&
    same(next.constraints, current.constraints) &&
    same(next.outOfScope, current.outOfScope)
  ) {
    return "the new Mission is the same as the current one.";
  }
  return null;
}

/**
 * The Done suggestion's evidence, kept to the records that may support it,
 * or why it cannot be offered: every success item needs at least one
 * standing understanding or misconception record behind it.
 */
export function doneEvidence(
  draft: DoneDraft,
  successItems: string[],
  standing: { number: number; kind: RecordKind }[],
): { ok: true; evidence: DoneEvidence } | { ok: false; problem: string } {
  if (draft.reason.trim() === "") return { ok: false, problem: "it gives the Learner no reason." };
  if (successItems.length === 0) return { ok: false, problem: "the Mission has no success items." };
  const supporting = new Set(
    standing.filter((r) => EVIDENCE_KINDS.has(r.kind)).map((r) => r.number),
  );
  const evidence: DoneEvidence = [];
  for (const [i, item] of successItems.entries()) {
    const cited = draft.evidence
      .filter((e) => e.successItem === i + 1)
      .flatMap((e) => e.records)
      .filter((n) => supporting.has(n));
    if (cited.length === 0) {
      return {
        ok: false,
        problem: `success item ${i + 1} (“${item}”) has no standing Learning record showing it.`,
      };
    }
    evidence.push({ successItem: i + 1, records: [...new Set(cited)].sort((a, b) => a - b) });
  }
  return { ok: true, evidence };
}

/**
 * Saves a proposal for the Learner to decide. A newer proposal of the same
 * kind takes the place of one still open.
 */
export async function insertProposal(
  tx: Tx,
  proposal: {
    courseId: string;
    lessonId: string;
    source: "finish" | "chat";
    reason: string;
  } & (
    | { kind: "mission_change"; mission: ProposedMission }
    | { kind: "done"; evidence: DoneEvidence }
  ),
): Promise<ProposalRow> {
  await tx
    .update(schema.proposal)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(
      and(
        eq(schema.proposal.courseId, proposal.courseId),
        eq(schema.proposal.kind, proposal.kind),
        eq(schema.proposal.status, "open"),
      ),
    );
  const [row] = await tx
    .insert(schema.proposal)
    .values({
      courseId: proposal.courseId,
      lessonId: proposal.lessonId,
      kind: proposal.kind,
      source: proposal.source,
      reason: proposal.reason.trim(),
      mission: proposal.kind === "mission_change" ? proposal.mission : null,
      evidence: proposal.kind === "done" ? proposal.evidence : null,
    })
    .returning();
  return row;
}

/** How many decided proposals the Teacher is reminded of. */
const DECLINED_SHOWN = 3;

/** Proposals the Teacher should not repeat: open ones, and the latest declined. */
export async function proposalContext(db: Db, courseId: string): Promise<ProposalContext[]> {
  const rows = await db
    .select({
      kind: schema.proposal.kind,
      status: schema.proposal.status,
      reason: schema.proposal.reason,
    })
    .from(schema.proposal)
    .where(
      and(
        eq(schema.proposal.courseId, courseId),
        inArray(schema.proposal.status, ["open", "declined"]),
      ),
    )
    .orderBy(desc(schema.proposal.createdAt));
  const open = rows.filter((r) => r.status === "open");
  const declined = rows.filter((r) => r.status === "declined").slice(0, DECLINED_SHOWN);
  return [...open, ...declined].map((r) => ({
    kind: r.kind,
    status: r.status as "open" | "declined",
    reason: r.reason,
  }));
}

/** Open proposals as the Learner sees them, oldest first; optionally only one Lesson's chat's. */
export async function readOpenProposals(
  db: Db,
  course: CourseRow,
  onlyChatOf: string | null = null,
): Promise<ProposalView[]> {
  if (course.isExample || course.status === "done") return [];
  const rows = await db
    .select()
    .from(schema.proposal)
    .where(
      and(
        eq(schema.proposal.courseId, course.id),
        eq(schema.proposal.status, "open"),
        ...(onlyChatOf === null
          ? []
          : [eq(schema.proposal.source, "chat"), eq(schema.proposal.lessonId, onlyChatOf)]),
      ),
    )
    .orderBy(asc(schema.proposal.createdAt), asc(schema.proposal.id));
  if (rows.length === 0) return [];
  const records = await db
    .select({ number: schema.learningRecord.number, title: schema.learningRecord.title })
    .from(schema.learningRecord)
    .where(eq(schema.learningRecord.courseId, course.id));
  return rows.map((row) => proposalView(row, course, records));
}

export function proposalView(
  row: ProposalRow,
  course: Pick<CourseRow, "missionSuccess">,
  records: { number: number; title: string }[],
): ProposalView {
  if (row.kind === "mission_change") {
    const { why, success, constraints, outOfScope } = row.mission!;
    return {
      id: row.id,
      kind: "mission_change",
      reason: row.reason,
      mission: { why, success, constraints, outOfScope },
    };
  }
  return {
    id: row.id,
    kind: "done",
    reason: row.reason,
    evidence: (row.evidence ?? []).map((e) => ({
      successItem: course.missionSuccess[e.successItem - 1] ?? "",
      records: e.records.flatMap((n) => records.filter((r) => r.number === n)),
    })),
  };
}

export function createProposalOperations({
  db,
  teacher,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  spend: Spend;
}) {
  /** The Learner's own open proposal, with its Course. */
  async function findOwnProposal(courseId: string, proposalId: string, learnerId: string) {
    const [row] = await db
      .select({ proposal: schema.proposal, course: schema.course })
      .from(schema.proposal)
      .innerJoin(schema.course, eq(schema.course.id, schema.proposal.courseId))
      .where(and(eq(schema.proposal.id, proposalId), eq(schema.course.id, courseId)));
    if (!row || row.course.isExample || row.course.learnerId !== learnerId) return null;
    return row;
  }

  /** Marks the proposal decided, if it is still open; false if it was not. */
  async function decide(tx: Tx, proposalId: string, status: "confirmed" | "declined") {
    const decided = await tx
      .update(schema.proposal)
      .set({ status, decidedAt: new Date() })
      .where(and(eq(schema.proposal.id, proposalId), eq(schema.proposal.status, "open")))
      .returning({ id: schema.proposal.id });
    return decided.length > 0;
  }

  /** The Course's other open proposals no longer apply once one is confirmed. */
  async function withdrawOthers(tx: Tx, courseId: string, proposalId: string) {
    await tx
      .update(schema.proposal)
      .set({ status: "withdrawn", decidedAt: new Date() })
      .where(
        and(
          eq(schema.proposal.courseId, courseId),
          eq(schema.proposal.status, "open"),
          ne(schema.proposal.id, proposalId),
        ),
      );
  }

  /**
   * Up next for the new Mission, when the Lesson waiting is still unwritten
   * and nobody is writing it; null to leave it as it is. A written Lesson
   * never changes: the Finish after it follows the new Mission. Past the
   * spend stop, the pause instead.
   */
  async function repickUpNext(course: CourseRow, mission: ProposedMission) {
    const [upNext] = await db
      .select()
      .from(schema.lesson)
      .where(and(eq(schema.lesson.courseId, course.id), isNull(schema.lesson.finishedAt)))
      .orderBy(desc(schema.lesson.index))
      .limit(1);
    if (!upNext || upNext.content !== null) return null;
    if (await findLessonJob(db, upNext.id, "lesson_generation")) return null;
    const paused = await spend.teacherCall();
    if (paused) return paused;

    const [records, finished, resources] = await Promise.all([
      db
        .select()
        .from(schema.learningRecord)
        .where(
          and(
            eq(schema.learningRecord.courseId, course.id),
            isNull(schema.learningRecord.supersededById),
          ),
        )
        .orderBy(asc(schema.learningRecord.number)),
      db
        .select({ title: schema.lesson.title, goal: schema.lesson.goal })
        .from(schema.lesson)
        .where(and(eq(schema.lesson.courseId, course.id), ne(schema.lesson.id, upNext.id)))
        .orderBy(asc(schema.lesson.index)),
      db.select().from(schema.resource).where(eq(schema.resource.courseId, course.id)),
    ]);
    resources.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
    const input = {
      subject: course.subject,
      language: course.language,
      mission: {
        why: mission.why,
        successLooksLike: mission.success,
        constraints: mission.constraints,
        outOfScope: mission.outOfScope,
        sittingMinutes: course.sittingMinutes,
      },
      learningRecords: [
        ...records.map((r) => ({ number: r.number, kind: r.kind, title: r.title, body: r.body })),
        // The record confirming will write.
        {
          number: Math.max(0, ...records.map((r) => r.number)) + 1,
          kind: "mission_change",
          ...mission.record,
        },
      ],
      finishedLessons: finished,
      resources: resources.map((r) => ({ kind: r.kind, title: r.title, why: r.why })),
    };
    const problem = (next: UpNextDraft) =>
      upNextProblem(next, course.sittingMinutes) ??
      (finished.some((l) => keyOf(l.title) === keyOf(next.title))
        ? `“${next.title.trim()}” is a finished Lesson; choose a new one.`
        : null);

    let feedback: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let picked: UpNextDraft;
      try {
        picked = await teacher.pickUpNext({ ...input, feedback });
      } catch (error) {
        if (attempt === 1) throw error;
        console.warn("Re-picking Up next failed; trying once more.", error);
        continue;
      }
      feedback = problem(picked);
      if (feedback === null) return { lessonId: upNext.id, next: picked };
    }
    throw new Error(`Up next broke its rules twice: ${feedback}`);
  }

  async function confirmMissionChange(
    course: CourseRow,
    proposal: ProposalRow,
  ): Promise<DecideProposalResult> {
    const mission = proposal.mission!;
    let upNext: Awaited<ReturnType<typeof repickUpNext>>;
    try {
      upNext = await repickUpNext(course, mission);
    } catch (error) {
      console.warn(`Course ${course.id}: re-picking Up next for a new Mission failed.`, error);
      return { ok: false, reason: "unavailable" };
    }
    if (upNext && "reason" in upNext) return upNext;

    return db.transaction(async (tx): Promise<DecideProposalResult> => {
      if (!(await decide(tx, proposal.id, "confirmed"))) return { ok: false, reason: "decided" };
      await withdrawOthers(tx, course.id, proposal.id);
      await tx
        .update(schema.course)
        .set({
          missionWhy: mission.why,
          missionSuccess: mission.success,
          missionConstraints: mission.constraints,
          missionOutOfScope: mission.outOfScope,
        })
        .where(eq(schema.course.id, course.id));

      const [{ last }] = await tx
        .select({ last: max(schema.learningRecord.number) })
        .from(schema.learningRecord)
        .where(eq(schema.learningRecord.courseId, course.id));
      await tx.insert(schema.learningRecord).values({
        courseId: course.id,
        number: (last ?? 0) + 1,
        kind: "mission_change",
        title: mission.record.title,
        body: mission.record.body,
        lessonId: proposal.lessonId,
      });

      if (upNext) {
        await tx
          .update(schema.lesson)
          .set({
            title: upNext.next.title.trim(),
            goal: upNext.next.goal.trim(),
            minutes: upNext.next.minutes,
          })
          .where(
            and(
              eq(schema.lesson.id, upNext.lessonId),
              isNull(schema.lesson.content),
              // Writing may have started meanwhile: then it stays as chosen.
              notExists(
                tx
                  .select({ id: schema.job.id })
                  .from(schema.job)
                  .where(
                    and(
                      eq(schema.job.lessonId, upNext.lessonId),
                      eq(schema.job.kind, "lesson_generation"),
                    ),
                  ),
              ),
            ),
          );
      }
      return { ok: true };
    });
  }

  async function confirmDone(course: CourseRow, proposal: ProposalRow) {
    return db.transaction(async (tx): Promise<DecideProposalResult> => {
      if (!(await decide(tx, proposal.id, "confirmed"))) return { ok: false, reason: "decided" };
      await withdrawOthers(tx, course.id, proposal.id);
      await tx
        .update(schema.course)
        .set({ status: "done", doneAt: new Date() })
        .where(and(eq(schema.course.id, course.id), eq(schema.course.status, "active")));
      return { ok: true };
    });
  }

  return {
    /**
     * The Learner confirms a proposal. A Mission change rewrites the Mission,
     * writes a mission-change Learning record and re-picks an unwritten Up
     * next; Done marks the Course Done. Either way the Course's other open
     * proposals are withdrawn. A Mission change that needs the Teacher waits
     * while it is paused for the day.
     */
    async confirmProposal(
      courseId: string,
      proposalId: string,
      learnerId: string,
    ): Promise<DecideProposalResult> {
      const found = await findOwnProposal(courseId, proposalId, learnerId);
      if (!found) return { ok: false, reason: "not-found" };
      const { proposal, course } = found;
      if (proposal.status !== "open" || course.status === "done") {
        return { ok: false, reason: "decided" };
      }
      return proposal.kind === "mission_change"
        ? confirmMissionChange(course, proposal)
        : confirmDone(course, proposal);
    },

    /** "Not now": the proposal is set aside and nothing changes. */
    async declineProposal(
      courseId: string,
      proposalId: string,
      learnerId: string,
    ): Promise<DecideProposalResult> {
      const found = await findOwnProposal(courseId, proposalId, learnerId);
      if (!found) return { ok: false, reason: "not-found" };
      const declined = await db.transaction((tx) => decide(tx, proposalId, "declined"));
      return declined ? { ok: true } : { ok: false, reason: "decided" };
    },
  };
}
