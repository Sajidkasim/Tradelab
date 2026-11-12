// Synthetic practice charts. Values are chart units, independent of market prices.
// The reveal count controls exactly what the player can see before answering.
const candle = ([open, high, low, close]) => ({open, high, low, close});
const setup = [56, 60, 44, 46];
const sweep = [46, 48, 31, 42];
const reclaim = [42, 52, 40, 49];
const confirm = [49, 63, 47, 59];

export const decisions = [
  {id:'early', reveal:3, answer:'Wait', explanation:'The low was swept and reclaimed. Wait for a close above the confirmation line.',
    candles:[setup,sweep,reclaim,confirm]},
  {id:'confirmed', reveal:4, answer:'Take', explanation:'The low was swept, price reclaimed it, and the confirmation candle closed above the line. The practice setup is valid.',
    candles:[setup,sweep,reclaim,confirm,[59,64,43,47]]},
  {id:'no-sweep', reveal:4, answer:'Pass', explanation:'Price rallied without trading below the marked low. This setup requires a sweep.',
    candles:[setup,[46,49,43,45],[45,54,44,52],[52,63,51,60],[60,66,55,64]]},
  {id:'failed-reclaim', reveal:4, answer:'Pass', explanation:'Price stayed below the marked low after the sweep. The reclaim failed.',
    candles:[setup,[46,48,31,37],[37,41,32,36],[36,39,28,32],[32,37,25,28]]},
  {id:'wick', reveal:4, answer:'Wait', explanation:'The wick crossed the confirmation line, but the candle closed underneath it. The rule requires a close.',
    candles:[setup,sweep,reclaim,[49,62,46,53],[53,66,51,62]]},
  {id:'chase', reveal:5, answer:'Pass', explanation:'The confirmation came earlier. Price has already moved away from that entry, so pass rather than chase.',
    candles:[setup,sweep,reclaim,confirm,[59,77,58,74],[74,81,61,64]]},
].map(round => ({...round, level:40, delivery:56, candles:round.candles.map(candle)}));
