// Original introductory copy. Team-authored resources remain independently editable.
export const STARTER_GUIDES = [
  {
    id: "chart",
    step: "01",
    label: "Read the chart",
    title: "Start with what the candle tells you.",
    summary:
      "Price, time and volume. Give each a meaning before looking for a setup.",
    body: "Each candle summarises an interval: the first traded price (open), highest price, lowest price and last traded price (close). The body spans open to close; the wicks reach the extremes. Volume records traded quantity for the feed. A candle does not reveal every price movement inside that interval.",
    exercise:
      "Open replay, pause on one completed candle and identify its open, high, low and close. Switch interval and notice how the same activity is grouped.",
    link: "/backtesting",
    action: "Open Backtesting",
  },
  {
    id: "risk",
    step: "02",
    label: "Define the risk",
    title: "Know the size before the result.",
    summary:
      "Direction, contract size, invalidation and costs belong in the same plan.",
    body: "A long position benefits from rising prices; a short position benefits from falling prices. Futures contracts have a multiplier and a minimum price increment (tick), so the same price move can mean different dollar amounts across contracts. Margin is a deposit requirement, not the maximum possible loss. Stops and targets describe your plan; gaps and slippage can change the execution price.",
    exercise:
      "Write down your instrument, contract quantity, entry, planned stop and target. Identify where commission and slippage enter the test.",
    link: "/journal",
    action: "Open Journal",
  },
  {
    id: "test",
    step: "03",
    label: "Test an idea",
    title: "Make the rule repeatable.",
    summary:
      "A useful test has specific rules and assumptions you can inspect.",
    body: "Specify the setup, entry trigger, session, exits and position size before testing. Use only information available at each decision time. Include costs, keep market-closed gaps and record the tested period. Minute candles cannot tell which level was reached first when both a stop and target lie inside one candle. Keep a separate period for checking rules after development.",
    exercise:
      "Describe one entry rule so another person could apply it without asking what you meant. Keep that wording with the test.",
    link: "/backtesting",
    action: "Open Backtesting",
  },
  {
    id: "review",
    step: "04",
    label: "Review the evidence",
    title: "Read beyond the win rate.",
    summary: "Outcomes, sample size and how you followed the plan all matter.",
    body: "Win rate tells you how often counted trades won, not how much they made. Average realised R adds outcome size relative to original risk. Drawdown describes declines from an earlier peak. Read these together with trade count, costs and the period tested. A small or repeatedly tuned historical sample can be misleading; past results do not establish future returns.",
    exercise:
      "In Strategy Lab, compare a selected setup with all your recorded trades. Note the trade count and whether original risk is available.",
    link: "/lab",
    action: "Open Strategy Lab",
  },
];
export const GLOSSARY = [
  [
    "Ask",
    "The price at which a seller is offering to sell. A market buy can execute at the ask or another available price.",
    "Entries",
  ],
  [
    "Backtest",
    "A historical simulation of defined trading rules. Its results depend on data, costs and fill assumptions.",
    "Research",
  ],
  [
    "Bid",
    "The price at which a buyer is offering to buy. The difference between bid and ask is the spread.",
    "Entries",
  ],
  [
    "Break-even",
    "A result of zero. Specify whether you mean before or after fees; costs can turn a flat price exit into a net loss.",
    "Risk",
  ],
  [
    "Confirmation",
    "A condition you require alongside the main setup. Define it precisely so it can be recorded or tested consistently.",
    "Entries",
  ],
  [
    "Drawdown",
    "The decline from an earlier equity peak to a later value. Check whether a report expresses this in dollars, percentages or R.",
    "Risk",
  ],
  [
    "Expectancy",
    "The average outcome per trade in a defined sample, expressed in dollars or R. An estimate from history, not a promise.",
    "Research",
  ],
  [
    "Key level / PDA",
    "A price area selected for a possible reaction. PDA means price delivery array in some trading approaches; record which specific level you mean.",
    "Structure",
  ],
  [
    "Look-ahead bias",
    "Using information in a historical decision that was only available later, making a simulation unrealistically informed.",
    "Research",
  ],
  [
    "Margin",
    "Funds required to open or maintain a leveraged futures position. It does not cap the amount you can lose.",
    "Risk",
  ],
  [
    "OHLCV",
    "Open, high, low, close and volume: the values used to summarise a candle.",
    "Structure",
  ],
  [
    "Out-of-sample",
    "Data kept separate from strategy development, used to evaluate the already-defined rules. Repeated tuning on it weakens that separation.",
    "Research",
  ],
  [
    "R-multiple",
    "A realised trade outcome divided by its original monetary risk. +2R means a gain twice that risk; realised R may include costs.",
    "Risk",
  ],
  [
    "Reward-to-risk / target RR",
    "The planned reward compared with planned risk, such as risking 1 to aim for 3. A 1:3 target is not a recorded +3R result.",
    "Risk",
  ],
  [
    "Session",
    "A defined trading time window. Its timezone, daylight-saving rules and overnight boundaries affect which candles belong to it.",
    "Structure",
  ],
  [
    "Slippage",
    "The difference between an expected execution price and the price actually received or assumed in a simulation.",
    "Entries",
  ],
  [
    "Stop-loss",
    "An exit instruction intended to limit losses. A stop price is not a guaranteed fill price.",
    "Risk",
  ],
  [
    "Tick / point",
    "A tick is the smallest permitted price increment for an instrument. A point is a full price unit; tick size and dollar value vary by contract.",
    "Structure",
  ],
  [
    "Win rate",
    "The proportion of counted trades that are winners. Primus Strategy Lab excludes break-even trades from its win-rate calculation.",
    "Research",
  ],
];
export function searchGlossary(query) {
  const q = query.trim().toLowerCase();
  return GLOSSARY.filter(([term, meaning, category]) =>
    `${term} ${meaning} ${category ?? ""}`.toLowerCase().includes(q),
  );
}
