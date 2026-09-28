-- success_metrics: the operator's four success metrics, as one row derived
-- from the timestamps the app already writes. Query it with
--   SELECT * FROM success_metrics;
-- Every share is a fraction between 0 and 1, null while its denominator is 0.
-- The Example course is left out of every metric. Deleted Courses and
-- Learners take their rows with them, so they drop out too.
--
-- 1. Interview → Lesson 1 finished
--    interviews_started: every Interview, claimed or not, redirected or not.
--    interviews_reaching_lesson_1: those whose Course has a finished Lesson 1.
--    interview_to_lesson_1_share: the second over the first.
--
-- 2. 7-day return for Lesson 2
--    learners_in_return_cohort: Learners with a Lesson 1 finished at least 7
--      days ago, so their 7-day window is over.
--    learners_returned_within_7_days: those who, in one of those Courses,
--      opened Lesson 2 within 7 days of finishing Lesson 1.
--    seven_day_return_share: the second over the first.
--
-- 3. Lesson time versus sitting length
--    Lesson time is finished_at minus opened_at, in minutes, over every
--    finished Lesson. opened_at is the first open, so the first Lesson time
--    also covers writing the Lesson.
--    lessons_timed: how many Lessons were measured.
--    median_lesson_minutes: their median Lesson time.
--    median_sitting_minutes: the median sitting length of their Courses.
--    median_lesson_to_sitting_ratio: the median of Lesson time over the
--      Course's sitting length; 1 means a Lesson takes exactly one sitting.
--
-- 4. Broken Resource URLs
--    A Resource is cited when a written Lesson names it in a section's
--    citations or in Read next. Only checked Resources count.
--    cited_resources: distinct cited Resources.
--    cited_resources_broken: those whose latest check_outcome is 'broken'.
--      Course creation drops broken URLs, so this stays 0 until something
--      re-checks cited Resources and writes 'broken'.
--    broken_resource_share: the second over the first.
--    (check_outcome is compared as text: 'broken' is added by 0011 in the
--    same migration transaction, and on a database where the enum already
--    existed Postgres refuses the new value's literal there.)
CREATE VIEW "success_metrics" AS
WITH
interview_funnel AS (
	SELECT
		count(*) AS interviews_started,
		count(*) FILTER (WHERE EXISTS (
			SELECT 1
			FROM "course" c
			JOIN "lesson" l ON l."course_id" = c."id"
			WHERE c."interview_id" = i."id" AND l."index" = 1 AND l."finished_at" IS NOT NULL
		)) AS interviews_reaching_lesson_1
	FROM "interview" i
),
lesson_1_finished AS (
	SELECT
		c."learner_id",
		l1."finished_at" AS lesson_1_finished_at,
		l2."opened_at" AS lesson_2_opened_at
	FROM "course" c
	JOIN "lesson" l1 ON l1."course_id" = c."id" AND l1."index" = 1
	LEFT JOIN "lesson" l2 ON l2."course_id" = c."id" AND l2."index" = 2
	WHERE NOT c."is_example"
		AND c."learner_id" IS NOT NULL
		AND l1."finished_at" <= now() - interval '7 days'
),
seven_day_return AS (
	SELECT
		count(DISTINCT "learner_id") AS learners_in_return_cohort,
		count(DISTINCT "learner_id") FILTER (
			WHERE lesson_2_opened_at <= lesson_1_finished_at + interval '7 days'
		) AS learners_returned_within_7_days
	FROM lesson_1_finished
),
timed_lessons AS (
	SELECT
		extract(epoch FROM l."finished_at" - l."opened_at")::double precision / 60 AS minutes,
		c."sitting_minutes"
	FROM "lesson" l
	JOIN "course" c ON c."id" = l."course_id"
	WHERE NOT c."is_example" AND l."opened_at" IS NOT NULL AND l."finished_at" IS NOT NULL
),
lesson_time AS (
	SELECT
		count(*) AS lessons_timed,
		percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes) AS median_lesson_minutes,
		percentile_cont(0.5) WITHIN GROUP (ORDER BY "sitting_minutes") AS median_sitting_minutes,
		percentile_cont(0.5) WITHIN GROUP (ORDER BY minutes / "sitting_minutes") AS median_lesson_to_sitting_ratio
	FROM timed_lessons
),
cited_resources AS (
	SELECT DISTINCT r."id", r."check_outcome"
	FROM "lesson" l
	JOIN "course" c ON c."id" = l."course_id"
	CROSS JOIN LATERAL (
		SELECT jsonb_array_elements_text(s.section -> 'citations') AS ref
		FROM jsonb_array_elements(l."content" -> 'sections') AS s(section)
		UNION
		SELECT l."content" ->> 'readNext'
	) cited
	JOIN "resource" r ON r."course_id" = l."course_id" AND r."ref" = cited.ref
	WHERE NOT c."is_example" AND l."content" IS NOT NULL AND r."check_outcome" IS NOT NULL
),
broken_resources AS (
	SELECT
		count(*) AS cited_resources,
		count(*) FILTER (WHERE "check_outcome"::text = 'broken') AS cited_resources_broken
	FROM cited_resources
)
SELECT
	f.interviews_started,
	f.interviews_reaching_lesson_1,
	f.interviews_reaching_lesson_1::double precision / nullif(f.interviews_started, 0) AS interview_to_lesson_1_share,
	r.learners_in_return_cohort,
	r.learners_returned_within_7_days,
	r.learners_returned_within_7_days::double precision / nullif(r.learners_in_return_cohort, 0) AS seven_day_return_share,
	t.lessons_timed,
	t.median_lesson_minutes,
	t.median_sitting_minutes,
	t.median_lesson_to_sitting_ratio,
	b.cited_resources,
	b.cited_resources_broken,
	b.cited_resources_broken::double precision / nullif(b.cited_resources, 0) AS broken_resource_share
FROM interview_funnel f
CROSS JOIN seven_day_return r
CROSS JOIN lesson_time t
CROSS JOIN broken_resources b;
