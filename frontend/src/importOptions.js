// Keep original import source IDs for duplicate matching; expose two testing types.
export const sourceOptions = [
  { value: "backtesting", label: "Backtesting" },
  { value: "live", label: "Live" },
];
export const testingType = (source) => ["fxreplay", "backtest"].includes(source) ? "backtesting" : "live";
export const testingLabel = (source) => testingType(source) === "backtesting" ? "Backtesting" : "Live";
export function sourceForType(type, current) {
  return testingType(current) === type ? current : type === "backtesting" ? "fxreplay" : "csv";
}
