export function fitChartPriceAxis(quotes) {
  let fit = null;
  for (const first of quotes) {
    for (const last of quotes) {
      if (last.y-first.y < .16 || last.price >= first.price) continue;
      const slope = (last.price-first.price)/(last.y-first.y);
      const at = y => first.price + (y-first.y)*slope;
      const supporting = quotes.filter(quote=>Math.abs(at(quote.y)-quote.price) <= Math.abs(slope)*.0035);
      if (supporting.length < 4 || supporting.length <= (fit?.count||0)) continue;
      const span = Math.max(...supporting.map(quote=>quote.y))-Math.min(...supporting.map(quote=>quote.y));
      if (span >= .25) fit = {at,count:supporting.length};
    }
  }
  return fit?.count >= quotes.length*.55 ? fit.at : null;
}

export function firstBoundaryTouch({target,stop}) {
  if (target == null && stop == null) return null;
  if (target != null && stop != null && Math.abs(target-stop) <= 3) return 'ambiguous';
  return stop == null || (target != null && target < stop) ? 'target' : 'stop';
}
