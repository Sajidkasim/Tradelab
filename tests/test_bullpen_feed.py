import asyncio

from webapp import bullpen_feed


def test_macro_feed_filters_headline_words_and_links():
    rows = [
        ("Powell speaks", "https://example.com/powell"),
        ("PPI released", "https://example.com/ppi"),
        ("Market appreciates", "https://example.com/unrelated"),
        ("Popular app", "https://example.com/app"),
        ("CPI", "javascript:alert(1)"),
    ]
    xml = "<rss><channel>" + "".join(
        f"<item><title>{title}</title><link>{link}</link>"
        "<pubDate>Fri, 06 Nov 2026 15:00:00 GMT</pubDate></item>"
        for title, link in rows
    ) + "</channel></rss>"
    items = list(bullpen_feed.parse_headlines(xml.encode(), "Test"))
    assert [item["title"] for item in items] == ["Powell speaks", "PPI released"]
    assert all(item["published"] is not None for item in items)


def test_macro_feed_shares_cache_and_retains_headlines_on_failure(monkeypatch):
    async def check():
        calls = []

        async def fetch(client, name, url):
            calls.append(name)
            if len(calls) > len(bullpen_feed.SOURCES):
                return None
            return [{"url": url, "published": 10}]

        monkeypatch.setattr(bullpen_feed, "_fetch", fetch)
        feed = bullpen_feed.MacroFeed()
        first, second = await asyncio.gather(feed.read(), feed.read())
        assert first == second
        assert len(calls) == len(bullpen_feed.SOURCES)
        feed.next_refresh = 0
        assert await feed.read() == {"items": first["items"], "stale": True}

    asyncio.run(check())
