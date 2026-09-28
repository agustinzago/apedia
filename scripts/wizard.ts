/**
 * Walks through getting Apedia live (issue #7, ADRs 0001 and 0003): Neon,
 * Anthropic, Resend, the operator and spend alarm, Auth.js, the site URL,
 * Polar, then Vercel. Checks each value, records it in
 * .env.wizard (gitignored, and not a file Next.js loads, so local builds never
 * see production values), copies the values to Vercel's Production
 * environment, migrates Neon and deploys. Safe to re-run: recorded values are
 * offered again and every step can be skipped.
 *
 *   npm run wizard
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface, type Interface } from "node:readline";
import { Pool } from "@neondatabase/serverless";
import {
  anthropicKeyProblem,
  checkAnthropicKey,
  checkLiveSignIn,
  checkResendDomain,
  databaseUrlProblem,
  generateAuthSecret,
  mask,
  operatorEmailProblem,
  operatorNameProblem,
  parseFromAddress,
  parseSiteUrl,
  polarAccessTokenProblem,
  polarProductIdProblem,
  polarServerProblem,
  polarWebhookSecretProblem,
  resendKeyProblem,
  spendThresholdProblem,
  type Check,
} from "./wizard/checks";
import { parseEnvFile, serializeEnvFile, type EnvValues } from "./wizard/env-file";
import { COURSE_CREDIT } from "../src/course/course-credit";

const ENV_FILE = ".env.wizard";
const HEADER = "Apedia production values, recorded by `npm run wizard`.\nSecrets: never commit this file.";

/** Every production variable, in the order they are set in Vercel. */
const VARIABLES = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "AUTH_RESEND_KEY",
  "AUTH_EMAIL_FROM",
  "AUTH_SECRET",
  "AUTH_URL",
  "APEDIA_OPERATOR_NAME",
  "APEDIA_CONTACT_EMAIL",
  "APEDIA_OPERATOR_EMAIL",
  "APEDIA_SPEND_ALARM_USD",
  "POLAR_SERVER",
  "POLAR_ACCESS_TOKEN",
  "POLAR_PRODUCT_ID",
  "POLAR_WEBHOOK_SECRET",
] as const;
type Variable = (typeof VARIABLES)[number];

/** The ones that are not secret, so the wizard may show them in full. */
const PLAIN: ReadonlySet<Variable> = new Set([
  "AUTH_EMAIL_FROM",
  "AUTH_URL",
  "APEDIA_OPERATOR_NAME",
  "APEDIA_CONTACT_EMAIL",
  "APEDIA_OPERATOR_EMAIL",
  "APEDIA_SPEND_ALARM_USD",
  "POLAR_SERVER",
  "POLAR_PRODUCT_ID",
]);

const values: EnvValues = existsSync(ENV_FILE) ? parseEnvFile(readFileSync(ENV_FILE, "utf8")) : {};

function record(name: Variable, value: string) {
  values[name] = value;
  const ordered = Object.fromEntries(
    VARIABLES.filter((v) => values[v] !== undefined).map((v) => [v, values[v]]),
  );
  writeFileSync(ENV_FILE, serializeEnvFile(ordered, HEADER), { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600);
}

function shown(name: Variable, value: string) {
  return PLAIN.has(name) ? value : mask(value);
}

// One readline, released while a child process (vercel link, the migration)
// needs the terminal, and opened again for the next question. Lines are read
// through its iterator, which buffers them, so piped answers are not lost.
let rl: Interface | undefined;
let lines: AsyncIterator<string> | undefined;

async function ask(question: string): Promise<string> {
  if (!rl || !lines) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
    lines = rl[Symbol.asyncIterator]();
  }
  rl.setPrompt(question);
  rl.prompt();
  const line = await lines.next();
  if (line.done) {
    console.log(`\n\nStopped. What you entered so far is in ${ENV_FILE}; re-run to continue.`);
    process.exit(1);
  }
  return line.value.trim();
}

function releaseTerminal() {
  rl?.close();
  rl = lines = undefined;
}

async function confirm(question: string, byDefault = true): Promise<boolean> {
  const answer = (await ask(`${question} ${byDefault ? "[Y/n]" : "[y/N]"} `)).toLowerCase();
  return answer === "" ? byDefault : answer.startsWith("y");
}

function heading(step: string, body: string[]) {
  console.log(`\n━━ ${step}\n`);
  for (const line of body) console.log(`   ${line}`);
  console.log();
}

/** Runs an online check; a network error means "could not check", not a crash. */
async function attempt(verify: (value: string) => Promise<Check>, value: string): Promise<Check> {
  try {
    return await verify(value);
  } catch (error) {
    return { status: "unchecked", reason: (error as Error).message };
  }
}

function report(check: Check): boolean {
  if (check.status === "ok") console.log("   ✓ Works.");
  if (check.status === "unchecked") console.log(`   ? Could not check: ${check.reason}`);
  if (check.status === "failed") console.log(`   ✗ ${check.problem}`);
  return check.status !== "failed";
}

/**
 * Asks for one variable until it has the right shape and passes its online
 * check (or the person keeps it anyway). A recorded value is offered first.
 */
async function obtain(
  name: Variable,
  prompt: string,
  {
    problem,
    verify,
  }: { problem: (value: string) => string | undefined; verify?: (value: string) => Promise<Check> },
): Promise<string> {
  const recorded = values[name];
  if (recorded !== undefined && !problem(recorded)) {
    if (await confirm(`   Keep the recorded ${name} (${shown(name, recorded)})?`)) {
      if (!verify || report(await attempt(verify, recorded))) return recorded;
      if (await confirm(`   Keep it anyway?`, false)) return recorded;
    }
  }
  for (;;) {
    const value = await ask(`   ${prompt}: `);
    const shapeProblem = problem(value);
    if (shapeProblem) {
      console.log(`   ✗ ${shapeProblem}`);
      continue;
    }
    if (verify && !report(await attempt(verify, value)) && !(await confirm(`   Keep it anyway?`, false))) {
      continue;
    }
    record(name, value);
    return value;
  }
}

async function checkDatabase(url: string): Promise<Check> {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query("select 1");
    return { status: "ok" };
  } catch (error) {
    return { status: "failed", problem: `Could not connect: ${(error as Error).message}` };
  } finally {
    await pool.end().catch(() => {});
  }
}

function run(command: string[], options: { input?: string; env?: EnvValues } = {}): boolean {
  const [bin, ...args] = command;
  releaseTerminal();
  const result = spawnSync(bin, args, {
    stdio: options.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
    input: options.input,
    env: { ...process.env, ...options.env },
  });
  return result.status === 0;
}

/**
 * Adds one variable to Vercel's Production environment. One that is already
 * there (say, DATABASE_URL managed by the Neon integration) is kept unless the
 * person chooses to replace it.
 */
async function setInVercel(
  vercel: string[],
  name: Variable,
  value: string,
): Promise<"set" | "kept" | "failed"> {
  const add = () => {
    const result = spawnSync(vercel[0], [...vercel.slice(1), "env", "add", name, "production"], {
      input: value,
      stdio: ["pipe", "inherit", "pipe"],
    });
    return { ok: result.status === 0, error: result.stderr?.toString() ?? "" };
  };
  const first = add();
  if (first.ok) return "set";
  if (!/already exists/i.test(first.error)) {
    process.stderr.write(first.error);
    return "failed";
  }
  if (!(await confirm(`   ${name} is already set in Production. Replace it?`, false))) return "kept";
  const removed = spawnSync(vercel[0], [...vercel.slice(1), "env", "rm", name, "production", "--yes"], {
    stdio: ["ignore", "inherit", "inherit"],
  });
  if (removed.status !== 0) return "failed";
  const second = add();
  if (!second.ok) process.stderr.write(second.error);
  return second.ok ? "set" : "failed";
}

/** The Vercel CLI: installed, or through npx. */
function vercelCli(): string[] {
  const installed = spawnSync("vercel", ["--version"], { stdio: "ignore" }).status === 0;
  return installed ? ["vercel"] : ["npx", "--yes", "vercel@latest"];
}

async function main() {
  console.log(`
Apedia go-live wizard

You will need accounts at neon.tech, console.anthropic.com, resend.com,
polar.sh and vercel.com, and access to the DNS of the domain Apedia sends
email from.
Values are recorded in ${ENV_FILE} as you go; re-run any time to pick up
where you left off.`);

  heading("1/8  Neon database", [
    "At console.neon.tech create a project in the region of your Vercel functions",
    "(Vercel's default, iad1, is AWS US East 1 in Neon), then Connect → copy the",
    "connection string. The pooled one (host with -pooler) is fine.",
  ]);
  const databaseUrl = await obtain("DATABASE_URL", "Neon connection string", {
    problem: databaseUrlProblem,
    verify: checkDatabase,
  });
  if (await confirm("   Apply migrations and seed the Example course now?")) {
    if (!run(["npm", "run", "db:migrate"], { env: { DATABASE_URL: databaseUrl } })) {
      console.log("   ✗ Migration failed; fix the error above and re-run the wizard.");
      process.exit(1);
    }
  }

  heading("2/8  Anthropic API key", [
    "At console.anthropic.com → API keys, create a key for Apedia. It only ever lives",
    "in Vercel's server environment: never in the client and never in the repo.",
  ]);
  await obtain("ANTHROPIC_API_KEY", "Anthropic API key", {
    problem: anthropicKeyProblem,
    verify: (key) => checkAnthropicKey(key),
  });

  heading("3/8  Resend sending domain", [
    "At resend.com/domains add the domain Apedia sends from (a subdomain like",
    "mail.your-domain.com keeps your main domain's reputation apart), add the DNS",
    "records Resend shows, and press Verify. Then create an API key at",
    "resend.com/api-keys. Full access lets the wizard check the domain for you.",
  ]);
  const resendKey = await obtain("AUTH_RESEND_KEY", "Resend API key", {
    problem: resendKeyProblem,
  });
  await obtain("AUTH_EMAIL_FROM", "Sender, e.g. Apedia <sign-in@mail.your-domain.com>", {
    problem: (from) => {
      const parsed = parseFromAddress(from);
      return "problem" in parsed ? parsed.problem : undefined;
    },
    verify: (from) => {
      const parsed = parseFromAddress(from) as { domain: string };
      return checkResendDomain(resendKey, parsed.domain);
    },
  });

  heading("4/8  You, the operator", [
    "The Privacy, Terms and Refund policy pages name who runs Apedia and give an",
    "address to write to; Polar requires both. Both are shown to the public.",
    "",
    "Apedia also emails you, through the same Resend domain, the first time a",
    "day's Claude spend passes a threshold. Per-Learner daily limits keep one",
    "Learner under about $1.70 a day; the threshold guards against a surge of",
    "sign-ups. That address stays private; it may be the same as the public one.",
  ]);
  await obtain("APEDIA_OPERATOR_NAME", "Your name, or your business's", {
    problem: operatorNameProblem,
  });
  await obtain("APEDIA_CONTACT_EMAIL", "Public contact email", {
    problem: operatorEmailProblem,
  });
  await obtain("APEDIA_OPERATOR_EMAIL", "Your email, for the alarm", {
    problem: operatorEmailProblem,
  });
  await obtain("APEDIA_SPEND_ALARM_USD", "Daily threshold in US dollars, e.g. 20", {
    problem: spendThresholdProblem,
  });

  heading("5/8  Auth.js secret", ["Signs Learners' sessions. The wizard generates one."]);
  if (values.AUTH_SECRET && (await confirm(`   Keep the recorded AUTH_SECRET (${mask(values.AUTH_SECRET)})?`))) {
    console.log("   ✓ Kept. (Changing it signs every Learner out.)");
  } else {
    record("AUTH_SECRET", generateAuthSecret());
    console.log("   ✓ Generated.");
  }

  heading("6/8  Site URL", [
    "The address Learners open; magic links point here. Your own domain, or the",
    "project's production domain in Vercel (e.g. https://apedia.vercel.app).",
    "It is set for Production only, so preview deployments keep their own URLs.",
  ]);
  const siteUrl = await obtain("AUTH_URL", "Site URL", {
    problem: (url) => {
      const parsed = parseSiteUrl(url);
      return "problem" in parsed ? parsed.problem : undefined;
    },
  });
  const origin = (parseSiteUrl(siteUrl) as { origin: string }).origin;
  if (origin !== siteUrl) record("AUTH_URL", origin);

  heading("7/8  Polar payments", [
    "Polar sells Course credits as the merchant of record. Use polar.sh for real",
    "payments, or sandbox.polar.sh (test cards, no money) to try it first; each",
    "has its own organization, product, token and webhook.",
    "",
    `1. Products → New product: "Course credit", one-time, US$${COURSE_CREDIT.priceUsd}. The price must`,
    "   match what Apedia shows (src/course/course-credit.ts). Copy its product ID.",
    "2. Settings → Developers → New token, with the checkouts:read and",
    "   checkouts:write scopes.",
    `3. Settings → Webhooks → Add endpoint: URL ${origin}/api/payments/webhook,`,
    "   format Raw, API version 2026-04 if asked, events order.paid and",
    "   order.refunded. Copy its secret.",
  ]);
  await obtain("POLAR_SERVER", "production or sandbox", { problem: polarServerProblem });
  await obtain("POLAR_ACCESS_TOKEN", "Polar access token", { problem: polarAccessTokenProblem });
  await obtain("POLAR_PRODUCT_ID", "Course credit product ID", { problem: polarProductIdProblem });
  await obtain("POLAR_WEBHOOK_SECRET", "Webhook secret", { problem: polarWebhookSecretProblem });

  heading("8/8  Vercel", [
    "Links this folder to a Vercel project (create it when asked), connects it to",
    "the GitHub repo so every push to master deploys to Production, copies the",
    "values above into the Production environment, and deploys.",
  ]);
  const vercel = vercelCli();
  if (await confirm("   Link and configure the Vercel project now?")) {
    if (!existsSync(".vercel/project.json") && !run([...vercel, "link"])) {
      console.log("   ✗ vercel link failed; re-run the wizard to try again.");
      process.exit(1);
    }
    if (await confirm("   Connect the project to this repo's GitHub remote?")) {
      // Fails harmlessly when the project is already connected.
      run([...vercel, "git", "connect"]);
    }
    let allSet = true;
    for (const name of VARIABLES) {
      const value = values[name];
      if (value === undefined) continue;
      const outcome = await setInVercel(vercel, name, value);
      if (outcome === "set") console.log(`   ✓ ${name} set in Production.`);
      if (outcome === "kept") console.log(`   ✓ ${name} already in Production; kept as it is.`);
      if (outcome === "failed") {
        console.log(`   ✗ Could not set ${name}.`);
        allSet = false;
      }
    }
    console.log(`
   In the Vercel dashboard, check Settings → Git → Production Branch is "master",
   and, if you use your own domain, add it under Settings → Domains.`);
    if (!allSet) {
      console.log("   ✗ Not deploying: set the variables marked ✗ first, then re-run.");
      process.exit(1);
    }
    if (await confirm("   Deploy to Production now?")) run([...vercel, "deploy", "--prod"]);
  }

  heading("Check the live site", [`Asking ${origin} for its sign-in options…`]);
  if (!report(await checkLiveSignIn(origin))) process.exit(1);
  console.log(`
   Last step, by hand: open ${origin}/sign-in, sign in with your own email and
   follow the link. When that works, Apedia is live.
`);
}

main()
  .then(releaseTerminal)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
