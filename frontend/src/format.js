export const money = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 2,
        signDisplay: "exceptZero",
      }).format(value);
export const percent = (value) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
export const rvalue = (value) =>
  value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
export const number = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
        value,
      );
export const tradeDate = (value) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
export const unknown = "Not recorded";
export const blankLabels = () => ({
  level: unknown,
  timeframe: unknown,
  entry_timeframe: unknown,
  condition: unknown,
  news: unknown,
  confirmations: [],
});
export function labelsOnly(labels) {
  const { reviewed, ...values } = labels || blankLabels();
  return values;
}
export const sourceNames = {
  fxreplay: "FX Replay",
  backtest: "Backtest",
  manual: "Live trade",
  csv: "Live CSV",
  excel: "Live Excel",
  api: "Broker",
};
export const backtestSources = ["backtest", "fxreplay"];
export function belongsTo(trade, scope) {
  return (
    scope === "All" ||
    (scope === "Backtesting"
      ? backtestSources.includes(trade.source)
      : ["manual", "csv", "excel", "api"].includes(trade.source))
  );
}

// Convert an explicit New York wall clock to UTC, rejecting DST gaps and ambiguous times.
// This is time interpretation only. All trade and strategy maths stays on the server.
export function nyToUtc(wall) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall))
    throw new Error("Enter the trade date and time.");
  const base = Date.parse(`${wall}:00Z`);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const matches = [4, 5]
    .map((offset) => new Date(base + offset * 3600000))
    .filter((d) => fmt.format(d).replace(" ", "T") === wall);
  if (matches.length !== 1)
    throw new Error(
      "This New York time is ambiguous or does not exist because of daylight saving. Choose another time.",
    );
  return matches[0].toISOString();
}

export function nyToday() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
