import { expect, test } from "@playwright/test";

test("a visitor reads the Example course's Reference sheet and prints it", async ({
  page,
}) => {
  await page.goto("/courses/example-music-theory");
  await page.getByRole("link", { name: "Reference sheet" }).click();

  await expect(page.getByRole("link", { name: "Reference sheet" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const sheet = page.getByRole("article", { name: "Reference sheet" });

  const keyIdeas = sheet.getByRole("region", { name: "Key ideas so far" });
  await expect(keyIdeas.getByRole("listitem")).toHaveText([
    /^1There are twelve notes\./,
    /^2A semitone is one fret; a tone is two frets\./,
  ]);

  const glossary = sheet.getByRole("region", { name: "Glossary" });
  await expect(glossary.getByRole("term")).toHaveText([
    "Octave",
    "Semitone",
    "Sharp",
    "Tone",
  ]);
  await expect(glossary.getByRole("definition").first()).toHaveText(
    "The same note name, twelve notes higher.",
  );

  await expect(
    sheet.getByRole("heading", { level: 3, name: "Distances on one string" }),
  ).toBeVisible();
  await expect(sheet.getByText(/12 frets = 1 octave/)).toBeVisible();

  // Print opens the browser's print dialog.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed++;
    };
  });
  await sheet.getByRole("button", { name: "Print" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);

  // On paper: no navigation or Print button, the sheet in the notebook fonts,
  // and nothing wider than an A4 page's printable width (the narrower of A4
  // and Letter).
  await page.setViewportSize({ width: 700, height: 1000 });
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation", { name: "Course" })).toBeHidden();
  await expect(page.getByRole("banner")).toBeHidden();
  await expect(sheet.getByRole("button", { name: "Print" })).toBeHidden();
  await expect(glossary.getByRole("term").first()).toHaveCSS(
    "font-family",
    /Kalam/,
  );
  await expect(glossary.getByRole("definition").first()).toHaveCSS(
    "font-family",
    /Patrick.Hand/,
  );
  await expect(glossary.locator("dl > div").first()).toHaveCSS(
    "break-inside",
    "avoid",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);

  for (const format of ["A4", "Letter"] as const) {
    const pdf = await page.pdf({ format });
    expect(pdf.byteLength).toBeGreaterThan(0);
  }
});
