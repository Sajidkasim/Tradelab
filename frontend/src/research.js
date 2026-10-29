export const matchesTest = (trade, selected) =>
  !selected ||
  (selected === "unassigned" ? !trade.study_id : trade.study_id === selected);

export const testOptions = (
  studies = [],
  selected = "",
  includeAll = false,
) => [
  ...(includeAll
    ? [
        { value: "", label: "All tests" },
        { value: "unassigned", label: "Not assigned to a test" },
      ]
    : [{ value: "", label: "Not assigned to a test" }]),
  ...studies
    .filter((test) => !test.archived || test.id === selected)
    .map((test) => ({
      value: test.id,
      label: `${test.name}${test.archived ? " · archived" : ""}`,
    })),
];

export function reviewIssues(trade) {
  return (
    trade.review_issues || [
      ...(!trade.setup_name
        ? [{ field: "strategy", label: "Missing strategy" }]
        : []),
      ...(!trade.labels?.reviewed
        ? [{ field: "confirmations", label: "Check confirmations" }]
        : []),
    ]
  );
}
