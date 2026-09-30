/**
 * The `teacher` module owns every Claude call and every prompt; no other
 * module talks to Claude. `course` depends only on the `Teacher` type, so
 * tests swap in the fake from `@/teacher/fake`.
 */
export * from "./contract";
export { claudeUnavailable, createClaudeTeacher } from "./claude";
