/**
 * The example answer shown in the Interview's empty answer box, per question
 * (1 why, 2 what they know, 3 success). The subjects of the Example courses
 * get examples of their own; any other subject gets ones that fit anything,
 * so a Learner learning chess is never shown a guitarist's answer.
 */

type Hints = Record<1 | 2 | 3, string>;

const TAILORED: { match: RegExp; hints: Hints }[] = [
  {
    match: /\b(music|guitar|piano|chords?|harmony|song ?writing)\b/i,
    hints: {
      1: "e.g. to understand the songs I play",
      2: "e.g. I can play a few chords",
      3: "e.g. work out a song’s chords myself",
    },
  },
  {
    match: /\b(garden(ing)?|vegetables?|allotment|grow(ing)?|compost)\b/i,
    hints: {
      1: "e.g. to eat salad I grew myself this summer",
      2: "e.g. I’ve kept a few pot plants alive",
      3: "e.g. pick a harvest from my own bed",
    },
  },
  {
    match: /\b(photo(graphy|s)?|camera|pictures?)\b/i,
    hints: {
      1: "e.g. my holiday photos never look like what I saw",
      2: "e.g. I just point my phone and tap",
      3: "e.g. take a family photo I’d print and frame",
    },
  },
];

const ANY_SUBJECT: Hints = {
  1: "e.g. what made you curious, or what you’ll use it for",
  2: "e.g. nothing yet, or a little from school",
  3: "e.g. something you’ll be able to do on your own",
};

export function answerPlaceholder(subject: string, questionNumber: number): string | undefined {
  if (questionNumber !== 1 && questionNumber !== 2 && questionNumber !== 3) return undefined;
  const hints = TAILORED.find((t) => t.match.test(subject))?.hints ?? ANY_SUBJECT;
  return hints[questionNumber];
}
