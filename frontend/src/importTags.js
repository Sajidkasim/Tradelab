export const weekdays = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
export const tagFields = [
  { value: "strategy", label: "Strategy", example: "e.g. Breakout and retest" },
  { value: "level", label: "Key level", example: "e.g. Previous day high" },
  { value: "confirmation", label: "Confirmation", example: "e.g. SMT" },
  { value: "timeframe", label: "Level timeframe", example: "e.g. 1H" },
  { value: "entry_timeframe", label: "Entry timeframe", example: "e.g. 1m" },
  { value: "target_rr", label: "Target RR", example: "e.g. 1:3" },
  { value: "weekday", label: "Day", example: "e.g. Monday" },
  { value: "news", label: "News", example: "e.g. Major news" },
  { value: "condition", label: "Market condition", example: "e.g. Trending" },
];
export function rulesOf(entry) {
  if (!entry || entry.ignore) return [];
  return entry.rules || [entry];
}
export function meaningText(entry) {
  if (entry?.ignore) return "Keep original tag only";
  const rules = rulesOf(entry).filter((r) => r.field && r.value);
  return rules.length
    ? rules
        .map(
          (rule) =>
            `${tagFields.find((f) => f.value === rule.field)?.label || rule.field}: ${rule.value}${rule.field === "target_rr" && rule.full_exit ? " · full target / stop" : ""}`,
        )
        .join(" · ")
    : "Choose what this tag means";
}
export function pendingTags(tags, saved) {
  return (tags || []).filter((tag) => !Object.hasOwn(saved || {}, tag));
}
export function cleanMeaning(rules, keepOnly) {
  if (keepOnly) return { ignore: true };
  if (
    !rules.length ||
    rules.length > 8 ||
    rules.some(
      (rule) =>
        !tagFields.some((field) => field.value === rule.field) ||
        !rule.value?.trim() ||
        (rule.field === "weekday" && !weekdays.includes(rule.value.trim())) ||
        rule.value.trim().length > 120,
    )
  ) {
    throw new Error(
      "Choose a category and a name for every meaning (up to 120 characters).",
    );
  }
  return {
    rules: rules.map((rule) => ({
      field: rule.field,
      value: rule.value.trim(),
      ...(rule.field === "target_rr" && rule.full_exit === true
        ? { full_exit: true }
        : {}),
    })),
  };
}
export function addTagMeaning(saved, tag, meaning, original = null) {
  const name = tag.trim();
  if (!name || name.length > 200)
    throw new Error(
      "Enter the CSV tag exactly as exported (up to 200 characters).",
    );
  if (name !== original && Object.hasOwn(saved, name))
    throw new Error(
      "This CSV tag is already saved. Edit its existing meaning instead.",
    );
  if (!Object.hasOwn(saved, name) && Object.keys(saved).length >= 200)
    throw new Error("Your guide holds up to 200 CSV tags.");
  // Adding an alias keeps the old spelling, so older exports still work.
  return { ...saved, [name]: meaning };
}
