import { expect, test } from "@playwright/test";

test("a visitor reads the Example course's Resources and Communities", async ({
  page,
}) => {
  await page.goto("/courses/example-music-theory");

  await page.getByRole("link", { name: "Resources", exact: true }).click();
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 2, name: "Trusted resources" }),
  ).toBeVisible();
  await expect(main.getByRole("heading", { level: 3 })).toHaveCount(5);
  await expect(
    main.getByRole("link", { name: "Open musictheory.net — Lessons on musictheory.net" }),
  ).toHaveAttribute("href", "https://www.musictheory.net/lessons");
  await expect(main.getByText(/ear training/)).toBeVisible();

  await page.getByRole("link", { name: "Communities", exact: true }).click();
  await expect(
    main.getByRole("heading", { level: 2, name: "Practise with people" }),
  ).toBeVisible();
  await expect(main.getByRole("link", { name: "r/musictheory" })).toHaveAttribute(
    "href",
    "https://www.reddit.com/r/musictheory/",
  );
  const offline = main
    .getByRole("listitem")
    .filter({ hasText: "A local acoustic jam or open-mic night" });
  await expect(offline.getByText("offline", { exact: true })).toBeVisible();
  // The Example course is read-only: no "Not for me".
  await expect(main.getByRole("button", { name: "Not for me" })).toHaveCount(0);
});

test("a visitor walks the Example course to a Lesson and answers its quiz", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "or open the Example course: Music theory" })
    .click();

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Music theory for the guitar you already play",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Path" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await page.getByRole("link", { name: /The major scale/ }).click();

  const main = page.getByRole("main");
  await expect(
    page.getByRole("heading", { level: 1, name: "The major scale" }),
  ).toBeVisible();
  await expect(main.getByText("Example course · read-only")).toBeVisible();

  // Column order: sections → New words → Remember → Practice → Check yourself → Read next + Ask your teacher.
  const headings = await main.getByRole("heading", { level: 2 }).allTextContents();
  expect(headings).toEqual([
    "One pattern of steps",
    "Starting somewhere else",
    "New words",
    "Remember",
    "Practice: Build G major on one string",
    "Check yourself",
    "Read next",
    "Ask your teacher",
  ]);

  await expect(
    main.getByRole("link", { name: "Source 3: JustinGuitar" }),
  ).toHaveAttribute("href", "https://www.justinguitar.com/");
  await expect(main).not.toContainText(/\br\d+\b/);
  await expect(main.getByText("A scale that follows the steps T T S T T T S.")).toBeVisible();
  await expect(main.getByRole("link", { name: "find it ↗" })).toHaveAttribute(
    "href",
    "https://www.musictheory.net/lessons",
  );

  // A wrong pick: red ✗ on it, the right answer marked, the rest faded.
  const pattern = main.getByRole("group", {
    name: "Which pattern of steps does every major scale follow?",
  });
  await pattern.getByRole("button", { name: "T S T T S T T" }).click();
  await expect(
    pattern.getByRole("button", { name: "T S T T S T T" }),
  ).toHaveAttribute("data-state", "wrong");
  await expect(
    pattern.getByRole("button", { name: /T T S T T T S/ }),
  ).toHaveAttribute("data-state", "right");
  await expect(
    pattern.getByRole("button", { name: "T T T S T T S" }),
  ).toHaveCSS("opacity", "0.5");
  await expect(pattern.getByRole("button")).toHaveCount(4);
  for (const option of await pattern.getByRole("button").all()) {
    await expect(option).toBeDisabled();
  }
  await expect(main.getByText(/✗ Not quite\. Tone, tone, semitone/)).toBeVisible();

  // Right picks.
  const seventh = main.getByRole("group", {
    name: "What is the seventh note of the G major scale?",
  });
  await seventh.getByRole("button", { name: "F sharp" }).click();
  await expect(seventh.getByRole("button", { name: /F sharp/ })).toHaveAttribute(
    "data-state",
    "right",
  );
  await expect(main.getByText(/✓ Correct\. A tone above E/)).toBeVisible();

  const reviewQuestion = "How many frets make a tone on one string?";
  const review = main.getByRole("group", { name: reviewQuestion });
  await expect(
    main
      .getByRole("listitem")
      .filter({ hasText: reviewQuestion })
      .getByText("review", { exact: true }),
  ).toBeVisible();
  await review.getByRole("button", { name: "Two frets" }).click();
  await expect(main.getByText(/✓ Correct\. A tone is two semitones/)).toBeVisible();

  const finish = main.getByRole("button", { name: "Finish" });
  await expect(finish).toBeVisible();
  await expect(finish).toBeDisabled();
  await expect(main.getByText(/sample course, so nothing is saved/)).toBeVisible();
});
