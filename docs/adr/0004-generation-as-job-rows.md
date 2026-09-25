# Run generation as job rows, not long requests

Research, Lesson generation and Finish run server-side via Next.js `after()`, writing progress to a job row in Postgres; the browser streams or polls that row. We rejected a single long streaming request (work dies when the tab closes) and a durable workflow service like Inngest or QStash (another vendor we don't need yet). Every step must fit Vercel's 300s function limit (ADR 0001); if one stops fitting, that is the signal to adopt a workflow service.

## Research is two steps

The pipeline prototype (`~/Code/apedia-pipeline-proto`, branch `prototype/pipeline`, `RESULTS.md`) measured research at 117–212 s, always hitting the search cap, with one run in four failing to parse only at the end, wasting the whole run. So research is split into two job steps: **search** (web search capped at 8 uses and a 240 s deadline; raw output saved to the job row), then **structure** (a separate structured-output call that produces Resources, Communities and Gaps and runs the URL check). A parse failure now costs seconds, not a new search.
