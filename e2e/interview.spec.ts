import { expect, test } from "@playwright/test";

test("a visitor answers the Interview and is asked to sign in to write the course", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/4 short questions/)).toBeVisible();
  await page.getByRole("link", { name: "Chess", exact: true }).click();

  await expect(page.getByText("Setting up a course on Chess")).toBeVisible();
  await expect(page.getByText(/Why do you want to learn Chess\?/)).toBeVisible();
  await expect(page.getByText("question 1 of 4")).toBeVisible();

  const answer = page.getByLabel("Your answer");
  await answer.fill("To beat my brother on Sundays");
  await answer.press("Enter");
  await expect(page.getByText(/What do you already know about it\?/)).toBeVisible();
  await expect(page).toHaveURL(/\/interview$/);
  await expect(page.getByText("question 2 of 4")).toBeVisible();

  await page.getByLabel("Your answer").fill("How the pieces move");
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByText(/a month from now and it worked/)).toBeVisible();

  await page.getByLabel("Your answer").fill("Win a game against my brother");
  await page.getByRole("button", { name: "send" }).click();
  await expect(page.getByText("Last question. How long is one sitting?")).toBeVisible();
  await expect(page.getByRole("button", { name: /min$/ })).toHaveText([
    "5 min",
    "10 min",
    "20 min",
    "30 min",
  ]);
  await page.getByRole("button", { name: "10 min" }).click();

  // The answers are stored: a reload shows the finished Interview.
  await expect(page.getByRole("button", { name: "Write my course" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Win a game against my brother")).toBeVisible();

  await page.getByRole("button", { name: "Write my course" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=(%2F|\/)interview$/);
  await expect(page.getByText(/Your answers are kept/)).toBeVisible();
});
