# Write Up next ahead of its first open

Up next used to be written on its first open, so every Lesson began with about a minute of "Your teacher is writing this Lesson". Now its Lesson generation job starts as soon as the job that picked it (Course creation or Finish) is done: `/api/jobs/[jobId]` asks `course.writeUpNextAfter` for it and starts it like any other step (ADR 0004). The first open finds the Lesson written, or follows the job already under way.

Writing ahead spends the same Teacher calls as writing on open, on a Lesson the Learner has already been handed, so it counts the same way: against the Course's allowance and the Learner's daily cap from when its writing starts, not from when it is opened. Whenever an open would be refused (lessons used up, daily cap, spend stop), nothing is written ahead and the first open behaves as before.

A Mission change waiting for the Learner holds the writing back, because confirming it re-picks Up next only while that Lesson is unwritten. Deciding the proposal, either way, starts the writing. We rejected writing ahead regardless (a confirmed Mission change would then wait a whole Lesson to take effect) and writing only on open (the delay the Learner sees at every Lesson).
