import { expect, test } from "@playwright/test";

// The Interview needs a signed-in Learner with a Course credit (ADR 0007),
// which the smoke test can't buy; it checks the way there keeps the subject.

test("a visitor who picks a subject is sent to sign in, and the subject is kept", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/4 short questions/)).toBeVisible();
  await page.getByRole("link", { name: "Chess", exact: true }).click();

  await expect(page).toHaveURL(/\/sign-in\?next=%2Finterview%3Fsubject%3DChess$/);
  await expect(page.getByText(/your course on Chess is kept for you/)).toBeVisible();
  await expect(page.locator('input[name="next"]')).toHaveValue("/interview?subject=Chess");
});

test("a subject typed on the home page rides along to sign-in", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("What would you like to learn?").fill("  Welsh & poetry  ");
  await page.getByRole("button", { name: "Begin" }).click();

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
