import { expect, test } from "@playwright/test";
import { COURSE_CREDIT } from "../src/course/course-credit";

const { priceUsd, lessons, chatQuestions, refundDays } = COURSE_CREDIT;

/** Plain words: nothing about how the Teacher works inside. */
const PLUMBING = /\b(model|token|prompt|Claude|Anthropic)s?\b/i;

test("a visitor sees the price on the home page, and what a Course includes", async ({
  page,
}) => {
  await page.goto("/");
  const main = page.getByRole("main");

  // The Example course comes first, free and one click away.
  await expect(
    main.getByRole("link", { name: /See a real Course first, free/ }),
  ).toHaveAttribute("href", "/courses/example-music-theory");

  await expect(
    main.getByRole("heading", { level: 2, name: `Start your own Course · $${priceUsd}` }),
  ).toBeVisible();
  await expect(
    main.getByText(/priced at cost, since Apedia doesn’t aim to profit/),
  ).toBeVisible();
  await expect(main.getByText(new RegExp(`up to ${lessons} Lessons`))).toBeVisible();
  await expect(main).not.toContainText(PLUMBING);

  await main.getByRole("link", { name: "What a Course includes" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pricing" })).toBeVisible();
  const pricing = page.getByRole("main");
  for (const text of [
    `A Course costs US$${priceUsd}, paid once.`,
    `Up to ${lessons} Lessons`,
    `Up to ${chatQuestions} questions`,
    "Sales tax or VAT may be added at checkout",
    `ask within ${refundDays} days`,
  ]) {
    await expect(pricing.getByText(text, { exact: false })).toBeVisible();
  }
  await expect(pricing.getByRole("link", { name: "Refund policy" })).toHaveAttribute(
    "href",
    "/refunds",
  );
  await expect(pricing).not.toContainText(PLUMBING);
});
