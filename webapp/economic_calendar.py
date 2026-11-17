"""Read scheduled US economic releases from official BLS, BEA and Federal Reserve calendars."""
from calendar import month_name
from datetime import date, datetime, timezone
from html import unescape
from html.parser import HTMLParser
import re
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

BLS = 'https://www.bls.gov/schedule'
BEA = 'https://www.bea.gov/news/schedule'
BEA_ARCHIVE = 'https://www.bea.gov/news/archive'
BEA_FEED = BEA + '/ics/online-calendar-subscription.ics'
FED = 'https://www.federalreserve.gov/newsevents'
EASTERN = ZoneInfo('America/New_York')
RELEASES = {
    'Employment Situation': 'US jobs report',
    'Consumer Price Index': 'CPI inflation',
    'Producer Price Index': 'PPI inflation',
    'Job Openings and Labor Turnover Survey': 'JOLTS job openings',
    'Employment Cost Index': 'Employment Cost Index',
    'U.S. Import and Export Price Indexes': 'Import and export prices',
}
_cache = {}
_lock = Lock()


class ScheduleRows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.row = None
        self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.row = []
        if tag in ('td', 'th') and self.row is not None:
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self.cell is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None
            self.cell = None

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)


def parse_schedule(html, month):
    parser = ScheduleRows()
    parser.feed(html)
    events = []
    dates_found = False
    for row in parser.rows:
        if len(row) != 3:
            continue
        day, time, release = row
        try:
            scheduled_day = datetime.strptime(day, '%A, %B %d, %Y').date()
        except ValueError:
            continue
        if scheduled_day.replace(day=1) != month:
            continue
        dates_found = True
        name = next((label for title, label in RELEASES.items() if release == title or release.startswith(title + ' for ')), release)
        try:
            clock = datetime.strptime(time, '%I:%M %p').time()
        except ValueError:
            # The agency can show a release as unscheduled or without a time.
            continue
        events.append({'name': name, 'source': 'BLS', 'currency': 'USD', 'scheduled_at': datetime.combine(scheduled_day, clock, EASTERN).isoformat()})
    if not dates_found:
        raise ValueError('No recognizable BLS calendar rows for this month.')
    return sorted(events, key=lambda event: event['scheduled_at'])


def parse_bea_feed(text):
    if not text.lstrip().startswith('BEGIN:VCALENDAR'):
        raise ValueError('Invalid BEA calendar feed.')
    events = []
    months = set()
    for block in re.findall(r'^BEGIN:VEVENT\s*\n(.*?)^END:VEVENT', re.sub(r'\r?\n[ \t]', '', text), re.M | re.S):
        fields = {}
        for line in block.splitlines():
            key, separator, value = line.partition(':')
            if separator:
                fields[key.split(';', 1)[0]] = value
        if fields.get('STATUS') == 'CANCELLED':
            continue
        try:
            at = datetime.strptime(fields.get('DTSTART', ''), '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).astimezone(EASTERN)
        except ValueError:
            continue
        months.add(at.date().replace(day=1))
        title = fields.get('SUMMARY', '').replace(r'\,', ',')
        if title.startswith('Personal Income and Outlays'):
            title = 'Personal Income and Outlays (PCE)'
        if not title:
            continue
        events.append({'name': title, 'source': 'BEA', 'currency': 'USD', 'scheduled_at': at.isoformat()})
    if not events:
        raise ValueError('No recognizable BEA releases.')
    return months, events


def parse_fed_schedule(html, month):
    label = f'{month_name[month.month]} {month.year}'
    if f'<h4 class="text-center">{label}</h4>' not in html:
        raise ValueError('No recognizable Federal Reserve calendar for this month.')
    events = []
    panels = re.split(r'<div class="panel (?:border )?panel-unstyled [^"]*">', html)
    for panel in panels[1:]:
        columns = re.search(r'<div class="col-xs-2">\s*<p>([^<]+)</p>\s*</div>\s*'
                            r'<div class="col-xs-7">\s*<p>(.*?)</p>.*?'
                            r'<div class="col-xs-3">\s*<p>(\d{1,2})</p>', panel, re.S)
        if not columns:
            continue
        time, title, day = columns.groups()
        title = unescape(re.sub(r'<[^>]+>', '', title)).strip()
        if title not in ('FOMC Meeting', 'FOMC Statement', 'FOMC Minutes', 'FOMC Press Conference'):
            continue
        try:
            clock = datetime.strptime(time.replace('.', '').strip().upper(), '%I:%M %p').time()
            at = datetime.combine(month.replace(day=int(day)), clock, EASTERN)
        except ValueError:
            continue
        events.append({'name': title, 'source': 'Fed', 'currency': 'USD', 'scheduled_at': at.isoformat()})
    return events


def bea_archive_years(html):
    select = re.search(r'<select[^>]*name="created_1"[^>]*>(.*?)</select>', html, re.S)
    if not select:
        raise ValueError('BEA archive year selector unavailable.')
    return {int(year): key for key, year in re.findall(r'<option value="(\d+)"[^>]*>\s*(\d{4})\s*</option>', select[1])}


def parse_bea_archive(html):
    releases = []
    for row in re.findall(r'<tr class="release-row">(.*?)</tr>', html, re.S):
        link = re.search(r'<a href="(/news/[^"<>]+)"[^>]*>(.*?)</a>', row, re.S)
        stamp = re.search(r'<time datetime="([^"]+)"', row)
        if not link or not stamp:
            continue
        try:
            at = datetime.fromisoformat(stamp[1])
            if at.utcoffset() is None:
                continue
        except ValueError:
            continue
        releases.append({'name': unescape(re.sub(r'<[^>]+>', '', link[2])).strip(),
                         'source': 'BEA', 'currency': 'USD', 'url': 'https://www.bea.gov' + link[1],
                         'scheduled_at': at.astimezone(EASTERN).isoformat()})
    if not releases or re.search(r'rel="next"|class="[^"]*pager__item--next', html):
        raise ValueError('A complete BEA archive product page is unavailable.')
    return releases


def archived_bea_events(month):
    years = cached_schedule(BEA_ARCHIVE, bea_archive_years) or {}
    year = years.get(month.year)
    if year is None:
        return [], False
    events = []
    complete = True
    # BEA's archive product IDs for GDP and Personal Income and Outlays.
    for product in (451, 476):
        url = f'{BEA_ARCHIVE}?created_1={year}&field_related_product_target_id={product}&title='
        rows = cached_schedule(url, parse_bea_archive)
        if rows is None:
            complete = False
        else:
            events.extend(event for event in rows if event['scheduled_at'].startswith(month.isoformat()[:7]))
    return events, complete


def cached_schedule(url, parser, *, calendar=False):
    now = monotonic()
    with _lock:
        cached = _cache.get(url)
        if cached and cached[0] > now:
            return cached[1]
    try:
        request = Request(url, headers={'User-Agent': 'PrimusTrader/1.0 (economic calendar)',
                                        'Accept': 'text/calendar' if calendar else 'text/html'})
        with urlopen(request, timeout=5) as response:
            raw = response.read(512_001)
        if len(raw) > 512_000:
            raise ValueError('Calendar response exceeds size limit.')
        result = parser(raw.decode('utf-8-sig', errors='replace'))
    except (OSError, ValueError):
        result = None
    with _lock:
        if url not in _cache and len(_cache) >= 48:
            _cache.pop(next(iter(_cache)))
        _cache[url] = (now + (3600 if result is not None else 60), result)
    return result


def monthly_schedule(day: date):
    month = day.replace(day=1)
    bls_url = f'{BLS}/{month.year}/{month.month:02d}_sched_list.htm'
    bls_events = cached_schedule(bls_url, lambda html: parse_schedule(html, month))
    bea = cached_schedule(BEA_FEED, parse_bea_feed, calendar=True)
    bea_available = bea is not None and month in bea[0]
    if bea_available:
        bea_events = [event for event in bea[1] if event['scheduled_at'].startswith(month.isoformat()[:7])]
        bea_url = BEA
    else:
        bea_events, bea_available = archived_bea_events(month)
        bea_url = BEA_ARCHIVE
    fed_url = f'{FED}/{month.year}-{month_name[month.month].lower()}.htm'
    fed_events = cached_schedule(fed_url, lambda html: parse_fed_schedule(html, month))
    events = (bls_events or []) + (fed_events or []) + bea_events
    sources = [
        {'name': 'BLS', 'url': bls_url, 'available': bls_events is not None},
        {'name': 'BEA', 'url': bea_url, 'available': bea_available},
        {'name': 'Fed', 'url': fed_url, 'available': fed_events is not None},
    ]
    return {'events': sorted(events, key=lambda event: event['scheduled_at']), 'sources': sources,
            'status': 'available' if events or any(source['available'] for source in sources) else 'unavailable'}
