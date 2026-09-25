# Apedia — Product Requirements (original)

> Original PRD as written before the grilling session on 2026-09-25. Where it conflicts with `CONTEXT.md` or `docs/adr/`, those win. Notably: there is no upfront lesson plan or upfront glossary (ADR 0002), accounts exist from day one (ADR 0003), and the ORM is Drizzle (ADR 0005).

## 1. Summary
Apedia is a "learn anything" web app. A user types a subject; a teacher (Claude) interviews them about *why*, then generates a short, mission-driven course of bite-sized lessons with practice, quizzes, sources and progress records.

It brings Matt Pocock's `/teach` skill to people who have never used Claude Code, skills, or a terminal. Everything the skill does with files in a folder, Apedia does behind a friendly, hand-drawn notebook UI.

**Design reference:** `Apedia v2.dc.html` (interactive prototype), `assets/ape-mascot.png` (mascot).

## 2. Users
- Curious adults
- High-school / university students
- Kids (reading level must stay simple; no account email required for under-13s — see Open questions)

All are assumed to have **zero** knowledge of AI tools. No prompts, tokens, models or files are ever exposed.

## 3. Principles (from the /teach skill — non-negotiable)
1. **Mission first.** No course without a mission (why, prior knowledge, success picture, session length). Every lesson references it.
2. **Zone of proximal development.** Each lesson is chosen from the mission + learning records; challenging "just enough".
3. **Small lessons, one tangible win.** Fits one sitting (5–30 min, user-chosen).
4. **Knowledge → skill.** Teach only what the skill needs, then practise with a tight feedback loop.
5. **Storage over fluency.** Retrieval practice, spacing, and interleaving (for skill topics).
6. **Never trust parametric knowledge.** Sources are researched and verified before teaching; lessons cite them.
7. **Quizzes give no formatting clues.** All options same word count / similar length; shuffled.
8. **Wisdom comes from people.** Point learners to real communities (opt-out respected).
9. **Glossary is canonical.** Once a term is defined, all later lessons use it consistently.

## 4. Core flows

### 4.1 Start
Home → user types a subject (or picks a suggestion, or opens the example notebook "Music theory").

### 4.2 Mission interview (chat with teacher)
Chat UI with the Ape mascot. Four turns:
1. Why do you want to learn {subject}?
2. What do you already know?
3. A month from now it worked — what can you do?
4. How long is one sitting? (chips: 5 / 10 / 20 / 30 min)

Teacher may ask **one** clarifying follow-up if an answer is empty or vague. Output: `Mission`.

### 4.3 Research (new — missing in prototype)
Server-side, before planning:
- Use Claude with the **web search tool** to find 5–10 high-trust resources (official docs, established books, university material, reputable sites).
- Verify each URL resolves; store title, author, kind, URL, one-line "why".
- Also find 2–3 communities (one offline option).
Output: `Resource[]`, `Community[]`. Show progress messages while running.

### 4.4 Course plan
Generate N lessons (default 6) ordered by dependency, each with title (≤6 words), goal (verb-first, ≤10 words), minutes. Plus initial glossary (6 terms). Plan must cite which resources it draws from.

### 4.5 Lesson (generated on first open, then cached)
Structure:
- Hook — why this matters for *their* mission
- 2–3 short sections (60–90 words), **each with ≥1 citation** to a stored resource
- Key idea ("Remember")
- Practice — 3–4 real-world steps
- Quiz — 3 questions (configurable), 4 options each, equal length; last question reviews an earlier lesson's key idea (spacing)
- Read next — the single best resource for this lesson
- Ask your teacher — in-lesson chat scoped to lesson + mission
- Finish — enabled when all quiz questions answered; writes a learning record

Three layout options exist in the prototype (Column / Margin notes / Page by page) — pick one before build (see Open questions).

### 4.6 Progress
Course page: learning path (done / up next / started), progress boxes, learning records (newest first: id, title, quiz score, date, insight).

### 4.7 Reference sheet (new)
Per course, a printable cheat sheet: glossary + key ideas + any syntax/steps. Print CSS must produce clean A4/Letter.

### 4.8 Spaced review (new)
- Wrong quiz answers and each lesson's key idea enter a review queue.
- Scheduling: simple Leitner boxes (1, 3, 7, 14, 30 days).
- Home and course page show "N things to review today"; review session = mixed quiz across lessons (interleaved).

## 5. Screens
| Screen | Prototype status |
|---|---|
| Home (3 options: Blank page / Teacher chat / Contents) | built — choose one |
| Mission interview (chat) | built |
| Loading / generating | built |
| Error + retry | built |
| Course: path + progress + records | built |
| Lesson (3 layout options) | built — choose one |
| Resources list | v1 only — port |
| Communities ("Practise with people") | v1 only — port |
| Cheat sheet / glossary | v1 only — port + print |
| Review session | not built |
| Account / notebooks list | partial (home) |

## 6. Data model
```
User { id, name?, ageBand?, createdAt }
Course {
  id, userId, subject, createdAt, isExample,
  mission: { why, know, success, time, summary, level },
  plan: { title, lessons: LessonStub[] },
  glossary: Term[], resources: Resource[], communities: Community[],
  notes: string        // teacher's NOTES.md: user preferences
}
LessonStub { index, title, goal, minutes }
Lesson {
  courseId, index, hook, sections: {heading, body, citations: resourceId[]}[],
  keyIdea, practice: {title, steps[]}, quiz: Question[], sourceId, newTerms: Term[]
}
Question { q, options[4], answer, explain, review: bool }
QuizAttempt { lessonIndex, questionIndex, chosen, correct, at }
LearningRecord { id "0001", lessonIndex, title, score, insight, at }
ReviewItem { courseId, kind: "question"|"keyIdea", ref, box, dueAt }
ChatMessage { courseId, lessonIndex, role, text, at }
Resource { id, title, author, kind, url, why, verifiedAt }
Community { name, where, url?, why, offline: bool }
Term { term, def, firstLesson }
```
Mapping to /teach files: `mission` = MISSION.md, `resources` = RESOURCES.md, `LearningRecord` = learning-records/*.md, `Lesson` = lessons/*.html, cheat sheet = reference/*.html, `notes` = NOTES.md. Offer **"Export as folder"** (zip in exactly that /teach layout) so users can later continue in Claude Code.

## 7. AI pipeline
All Claude calls server-side (API key never in client). JSON outputs validated with a schema (zod); on invalid JSON, retry once with the validation error.

| Step | Model | Tools | Notes |
|---|---|---|---|
| Interview follow-up | Haiku | — | optional, 1 turn max |
| Research | Sonnet | web_search | verify URLs with HEAD request |
| Plan | Sonnet | — | input: mission + resources |
| Lesson | Sonnet | — | input: mission, plan, resources, glossary, prior key ideas, learning records |
| Quiz lint | code | — | reject if option word counts differ; regenerate |
| Teacher chat | Haiku | — | <80 words; suggest a community for "wisdom" questions |
| Update notes | Haiku | — | extract learning preferences from chat → `Course.notes` |

System tone: calm and clear, like a good textbook. Plain words; define jargon. Age-appropriate when `ageBand` is kid.

Safety: refuse/redirect harmful subjects; kid mode filters communities (no open forums).

## 8. Visual design
Hand-drawn notebook, inspired by Excalidraw (original — do not copy its UI).
- **Fonts:** Kalam 700 (headings, buttons), Patrick Hand (body). Google Fonts.
- **Paper:** `#fbfaf6` with 22px grid lines `#eceff4`. Ink `#1e1e1e`, secondary `#3d3d3d`, muted `#5b5b5b`.
- **Accents (oklch):** highlighter `0.93 0.11 98`, blue `0.5 0.14 255`, red `0.58 0.17 28`, green `0.52 0.14 150`. Tints: blue `0.96 0.03 250`, green `0.94 0.05 150`, sticky-note yellow `0.96 0.07 95`.
- **Sketchy borders:** 2px ink + irregular radius, e.g. `255px 15px 225px 15px / 15px 225px 15px 255px` (and its mirror). Circles: `50% 46% 54% 48%`.
- **Highlighter** on key words (skewed linear-gradient behind text).
- Sticky notes: yellow fill, 2px 3px 0 soft shadow, no border.
- Quiz feedback: green border + tint + ✓ for correct, red + ✗ for chosen wrong, others fade to 50%.
- Mascot: `assets/ape-mascot.png`, always circular.
- Desktop-first (≥1024px); must not break down to 768px.

## 9. Tech (suggested)
Next.js (App Router) + TypeScript, Anthropic SDK, Postgres (Prisma) or SQLite for MVP, auth via magic link (optional guest mode with localStorage → claim later). Stream generation progress to the client (SSE). Cache lessons; never regenerate a finished lesson.

## 10. MVP scope
In: home, interview, research, plan, lesson, quiz, finish/records, course page, cheat sheet (print), resources, communities, guest mode, example notebook.
Later: spaced review, export-as-folder, accounts, kid mode, mobile, mascot animations.

Non-goals: video generation, live tutors, payments, social features inside the app.

## 11. Success metrics
- ≥60% of users who start the interview finish lesson 1
- ≥40% return within 7 days for lesson 2 or review
- Median lesson completion time within ±30% of the chosen session length
- <2% of cited resource URLs broken

## 12. Open questions
1. Home layout: A Blank page, B Teacher chat, or C Contents?
2. Lesson layout: A Column, B Margin notes, or C Page by page?
3. Kids: separate mode with parental consent, or exclude under-13s from MVP?
4. Guest mode only, or accounts from day one?
5. Cost cap per user (generation is ~5–8 Claude calls per course + 1 per lesson)?

All five open questions were resolved in the grilling session; see `CONTEXT.md` and `docs/adr/`.
