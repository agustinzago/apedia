# Apedia

A "learn anything" web app that runs the /teach method for people who have never used AI tools: a Teacher interviews the Learner about their Mission, then teaches them through short Lessons grounded in verified Resources.

## People and roles

**Learner**:
A signed-in person, aged 13 or over, who is learning through Apedia.
_Avoid_: User (in domain talk), student

**Teacher**:
The voice that interviews, teaches and answers questions in a Course. Drawn as the Ape mascot.
_Avoid_: Ape, AI, assistant, bot, tutor

## The course

**Course**:
Everything Apedia holds for one Learner learning one subject: its Mission, Lessons, Resources, Communities and records. One subject, one Mission, one Course.
_Avoid_: Notebook (that is the visual style, not a concept), workspace

**Course credit**:
What one purchase buys a Learner: the right to start one Course. It is available until "Write my course" uses it, and a full refund takes back an unused one.
_Avoid_: Token, ticket, license, seat, purchase (for the credit itself)

**Allowance**:
What a Course credit lets its Course use: a fixed number of Lessons written (Finish included) and of questions to the Teacher across its Lessons. Once it is used up, everything written stays, and another Course keeps the Learner going on a new Mission.
_Avoid_: Quota, budget, limit (limits are the daily caps and spend limits)

**Example course**:
A pre-made, read-only Course ("Music theory") that anyone can open to see what a Course looks like.
_Avoid_: Example notebook, demo

**Interview**:
The short conversation in which the Teacher draws out the Mission before a Course exists. It happens after the Learner signs in, backed by an available Course credit, and stays open until its Course is written.
_Avoid_: Onboarding, form, wizard

**Mission**:
The reason a Learner wants to learn the subject: why, what success looks like, the constraints (including session length) and what is out of scope. Every Lesson traces back to it; it may change only with the Learner's confirmation.
_Avoid_: Goal, objective

**Done**:
A Course is done when the Learner confirms that the Mission's success picture has been met.
_Avoid_: Complete, finished (for a Course)

## Teaching

**Lesson**:
One short, self-contained piece of teaching that gives the Learner a single tangible win toward the Mission, sized to one sitting.
_Avoid_: Module, unit, chapter

**Finish**:
The moment a Learner closes out a Lesson after answering every quiz question. It is when the Teacher weighs the evidence, writes Learning records, grows the Glossary and Reference sheet, and picks Up next.
_Avoid_: Complete, submit

**Up next**:
The single Lesson the Teacher has chosen to teach next, picked from the Mission and the Learning records. There is no upfront plan beyond it.
_Avoid_: Plan, roadmap, curriculum

**Key idea**:
The one thing a Lesson asks the Learner to remember.
_Avoid_: Takeaway, summary

**Quiz attempt**:
A Learner's answer to one quiz question in a Lesson, right or wrong.
_Avoid_: Score (a score is derived from attempts)

**Learning record**:
A numbered, evidence-based note of what the Learner now knows: understanding shown, prior knowledge disclosed, a misconception corrected, or a Mission change. Covering material is not enough to earn one.
_Avoid_: Progress entry, log, journal

## Knowledge and wisdom

**Resource**:
A high-trust source (book, docs, course, article) that has been found and verified to exist, and that Lessons cite.
_Avoid_: Source, link, reference

**Gap**:
A part of the Mission that no Resource covers yet.
_Avoid_: Missing source, hole

**Community**:
A real place, online or offline, where the Learner can practise with other people and gain wisdom.
_Avoid_: Forum, group

**Glossary**:
The Course's canonical terms, each added only once the Learner has shown they understand it. Every later Lesson must use its words.
_Avoid_: Dictionary, vocabulary list

**Reference sheet**:
The printable, compressed essence of a Course, designed for quick lookup. It holds the Glossary, the Key ideas, and topic-specific sections, and grows with every finished Lesson.
_Avoid_: Cheat sheet, summary

## Relationships

- **Course credit → Interview**: an available Course credit backs at most one open Interview. A redirected subject uses no credit.
- **Course credit → Course**: "Write my course" uses the Interview's credit, which becomes that one Course. Giving up on (deleting) a Course whose creation failed before finding any Resources gives the credit back.
- **Interview → Course**: one Interview, one Course.
- **Course → Allowance**: every Course a Learner owns has one allowance, counted from its own Lessons and chat; the Example course has none.
