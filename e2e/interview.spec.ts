import { expect, test } from "@playwright/test";

// The Interview needs a signed-in Learner with a Course credit (ADR 0007),
// which the smoke test can't buy; it checks the way there keeps the subject.

test("a visitor who buys a Course is sent to sign in first, then to choose a subject", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Buy a Course/ }).first().click();

  await expect(page).toHaveURL(/\/sign-in\?next=%2Fstart$/);
  await expect(page.locator('input[name="next"]')).toHaveValue("/start");

  // Choosing what to learn needs a signed-in Learner too.
  await page.goto("/start");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fstart$/);
});

test("a subject in an Interview link rides along to sign-in", async ({ page }) => {
  await page.goto(`/interview?${new URLSearchParams({ subject: "  Welsh & poetry  " })}`);

  await expect(page.getByText(/your course on Welsh & poetry is kept for you/)).toBeVisible();
  await expect(page.locator('input[name="next"]')).toHaveValue(
    "/interview?subject=Welsh+%26+poetry",
  );
});

test("a visitor can't reach an Interview by its address", async ({ page }) => {
  await page.goto("/interview?id=someone-elses");
  await expect(page).toHaveURL(/\/sign-in\?next=/);

  await page.goto("/interview");
  await expect(page).toHaveURL(/\/$/);
});
