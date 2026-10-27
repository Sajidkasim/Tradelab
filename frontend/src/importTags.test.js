import { expect, it } from "vitest";
import {
  pendingTags,
  cleanMeaning,
  addTagMeaning,
  meaningText,
} from "./importTags";

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
