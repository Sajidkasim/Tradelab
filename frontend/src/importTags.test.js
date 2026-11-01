import { expect, it } from "vitest";
import {
  pendingTags,
  cleanMeaning,
  addTagMeaning,
  meaningText,
} from "./importTags";

it("weekday meanings use a real day and are described plainly", () => {
  expect(cleanMeaning([{ field: "weekday", value: "Friday" }], false)).toEqual({
    rules: [{ field: "weekday", value: "Friday" }],
  });
  expect(meaningText({ field: "weekday", value: "Monday" })).toBe(
    "Day: Monday",
  );
  expect(() =>
    cleanMeaning([{ field: "weekday", value: "Funday" }], false),
  ).toThrow();
});

it("only unfamiliar tags need attention; deliberately kept tags are remembered", () => {
  const saved = {
    SMT: { field: "confirmation", value: "SMT" },
    Note: { ignore: true },
  };
  expect(pendingTags(["SMT", "Note", "NEW MODEL"], saved)).toEqual([
    "NEW MODEL",
  ]);
  expect(meaningText(saved.Note)).toBe("Keep original tag only");
});
it("Lab tags and saved exceptions ignore capitals, spacing and punctuation", () => {
  expect(pendingTags([" s m t ", "MY_NEW-SETUP", "unknown"],
    { SMT: {field:"confirmation",value:"SMT"} },
    { "My new setup": {field:"strategy",value:"My new setup"} })).toEqual(["unknown"]);
  expect(meaningText({field:"timeframe",value:"2H"})).toBe("Key level timeframe: 2H");
});
it("new strategy aliases keep the old wording and every other meaning", () => {
  const old = {
    OLD: { field: "strategy", value: "Breakout" },
    SMT: { field: "confirmation", value: "SMT" },
  };
  const next = addTagMeaning(old, " NEW ", old.OLD);
  expect(next.NEW).toEqual(old.OLD);
  expect(next.OLD).toEqual(old.OLD);
  expect(next.SMT).toEqual(old.SMT);
  expect(old.NEW).toBeUndefined();
});
it("requires explicit fields and values, preserves composite meanings and rejects collisions", () => {
  expect(() => cleanMeaning([{ field: "", value: "" }], false)).toThrow();
  expect(cleanMeaning([], true)).toEqual({ ignore: true });
  expect(
    cleanMeaning(
      [
        { field: "level", value: " FVG " },
        { field: "timeframe", value: "1H" },
      ],
      false,
    ),
  ).toEqual({
    rules: [
      { field: "level", value: "FVG" },
      { field: "timeframe", value: "1H" },
    ],
  });
  expect(() =>
    addTagMeaning({ TAG: { ignore: true } }, "TAG", { ignore: true }),
  ).toThrow("already saved");
  expect(() => addTagMeaning({}, " ", { ignore: true })).toThrow();
  expect(() =>
    cleanMeaning([{ field: "strategy", value: "x".repeat(121) }], false),
  ).toThrow();
});

it("fixed-RR confirmation is saved only for the target category", () => {
  expect(
    cleanMeaning(
      [{ field: "target_rr", value: "1:3", full_exit: true }],
      false,
    ),
  ).toEqual({ rules: [{ field: "target_rr", value: "1:3", full_exit: true }] });
  expect(
    meaningText({ field: "target_rr", value: "1:3", full_exit: true }),
  ).toContain("full target / stop");
  expect(
    cleanMeaning(
      [{ field: "strategy", value: "My model", full_exit: true }],
      false,
    ).rules[0],
  ).not.toHaveProperty("full_exit");
});
