import { expect, test } from "@playwright/test";

test("the footer links the small print and credits /teach", async ({ page }) => {
  await page.goto("/");
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByRole("link", { name: "/teach" })).toHaveAttribute(
    "href",
    "https://github.com/mattpocock/skills/tree/main/skills/productivity/teach",
  );

  for (const name of ["Pricing", "Privacy", "Terms", "Refund policy", "Credits"]) {
    await footer.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  }

  // The smoke test sets no operator, so the pages say so plainly.
  await page.goto("/terms");
  await expect(page.getByText(/\[APEDIA_OPERATOR_NAME is not set\]/)).toBeVisible();
});
