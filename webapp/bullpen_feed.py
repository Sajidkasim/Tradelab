"""Cached public RSS headlines for the private Bullpen sidebar."""
import asyncio
import re
import time
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from xml.etree import ElementTree

import httpx

SOURCES = (
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("Bureau of Labor Statistics", "https://www.bls.gov/feed/bls_latest.rss"),
    ("CNBC Markets", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
)
KEYWORDS = re.compile(
    r"\b(?:CPI|PPI|FOMC|NFP|Payroll|Payrolls|Powell|Fed|Rates|Treasury|Yield|Yields|Inflation|GDP|PCE|Tariff|Tariffs|Nasdaq|S&P|Gold|Oil|Jobs|Unemployment|Recession|Nvidia|NVDA|Apple|AAPL|Microsoft|MSFT|Tesla|TSLA|Meta|Amazon|AMD)\b",
    re.IGNORECASE,
)
REFRESH_SECONDS = 90
MAX_BYTES = 512 * 1024


def parse_headlines(data, source):
    data = data.decode("utf-8-sig")
    if re.search(r"<!\s*(?:DOCTYPE|ENTITY)", data, re.IGNORECASE):
        raise ValueError("Unexpected RSS declaration")
    for item in ElementTree.fromstring(data).iterfind(".//item"):
        title = " ".join(item.findtext("title", "").split())
        link = item.findtext("link", "").strip()
        if not KEYWORDS.search(title) or urlsplit(link).scheme != "https":
            continue
        try:
            published = parsedate_to_datetime(item.findtext("pubDate", ""))
            timestamp = published.timestamp() if published.tzinfo else None
        except (ValueError, TypeError, OverflowError):
            timestamp = None
        yield {"title": title, "url": link, "source": source, "published": timestamp}


async def _fetch(client, source, url):
    try:
        async with asyncio.timeout(6), client.stream("GET", url) as response:
            response.raise_for_status()
            data = bytearray()
            async for chunk in response.aiter_bytes(chunk_size=8192):
                if len(data) + len(chunk) > MAX_BYTES:
                    return None
                data.extend(chunk)
        return list(parse_headlines(data, source))
    except (httpx.HTTPError, TimeoutError, ValueError, ElementTree.ParseError):
        return None


class MacroFeed:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.next_refresh = 0
        self.by_source = {}
        self.result = {"items": [], "stale": False}

    async def read(self):
        if time.monotonic() < self.next_refresh:
            return self.result
        async with self.lock:
            if time.monotonic() < self.next_refresh:
                return self.result
            async with httpx.AsyncClient() as client:
                batches = await asyncio.gather(*(_fetch(client, *source) for source in SOURCES))
            for (name, _), batch in zip(SOURCES, batches):
                if batch is not None:
                    self.by_source[name] = batch
            items = {item["url"]: item for batch in self.by_source.values() for item in batch}
            self.result = {
                "items": sorted(items.values(), key=lambda item: item["published"] or 0, reverse=True)[:30],
                "stale": any(batch is None for batch in batches),
            }
            self.next_refresh = time.monotonic() + REFRESH_SECONDS
            return self.result
