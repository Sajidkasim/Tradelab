import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, Clock3, Gauge, Layers3, Minus,
  ShieldCheck, RefreshCw, Send, Copy, Check, CalendarClock, Flame,
  BarChart3, AlertTriangle, Compass, Zap,
} from 'lucide-react';
import { PrimusHeader, localSitePreview } from './SiteExperience';
import { api } from './api';
import { matrixFreshness } from './matrixFreshness';
import { useBullpen } from './hooks/usePresence';
import MatrixLoading from './MatrixLoading';
import './matrix.css';

const TOP_TICKERS = [
  { id: 'nq', label: 'NQ1!', name: 'Nasdaq-100 Futures' },
  { id: 'es', label: 'ES1!', name: 'S&P 500 Futures' },
  { id: 'xau', label: 'Gold', name: 'COMEX Gold Futures' },
  { id: 'vix', label: 'VIX', name: 'Implied Volatility' },
  { id: 'dgs10', label: '10Y Yield', name: 'US 10Y Treasury' },
  { id: 'dxy', label: 'DXY', name: 'US Dollar Index' },
];

const DEMO_SNAPSHOT = {
  asOf: new Date().toISOString(),
  tickers: [
    { id: 'nq', value: '24,186.25', change: '+0.62%', direction: 'up', spark: [23600, 23740, 23810, 23790, 23940, 24020, 24186] },
    { id: 'es', value: '6,042.50', change: '+0.41%', direction: 'up', spark: [5950, 5975, 5982, 5995, 6012, 6024, 6042] },
    { id: 'xau', value: '2,684.40', change: '+0.55%', direction: 'up', spark: [2610, 2630, 2642, 2638, 2655, 2670, 2684] },
    { id: 'vix', value: '16.42', change: '-0.71 pts', direction: 'down', spark: [19.1, 18.6, 18.2, 17.8, 17.4, 17.1, 16.42] },
    { id: 'dgs10', value: '4.24%', change: '-4 bp', direction: 'down', spark: [4.38, 4.35, 4.32, 4.30, 4.29, 4.28, 4.24] },
    { id: 'dxy', value: '101.46', change: '-0.22%', direction: 'down', spark: [102.4, 102.2, 102.0, 101.9, 101.8, 101.7, 101.46] },
  ],
  swing: {
    score: 71,
    bias: 'Strong Bullish',
    metrics: [
      { id: 'cot', value: '+18.4%', detail: 'CFTC · Nasdaq-100 E-mini · 72nd pct (52w)', spark: [12, 14, 13.5, 15.2, 16.8, 18.4] },
      { id: 'credit', value: '318 bp', change: '-6 bp', direction: 'down', detail: 'FRED · HY Credit Spread', spark: [342, 336, 331, 328, 324, 318] },
      { id: 'fed', value: '$6.12T', change: '+48B 4w', direction: 'up', detail: 'Fed Net Liquidity (WALCL − TGA − RRP)', spark: [6.04, 6.06, 6.07, 6.09, 6.10, 6.12] },
      { id: 'cpi', value: '2.74%', detail: 'Core CPI YoY · Cooling (-0.08% vs prior)' },
    ],
  },
  intraday: {
    sizing: 'standard',
    reasons: ['Clean macro & volatility tape — standard NQ/MNQ execution rules apply'],
    impliedMove: { vix: 16.42, dailyPct: 1.03, nqPoints: 250, label: '±1.03% (~250 pts on NQ)' },
    metrics: [
      { id: 'yield', value: '-11 bp', detail: '10Y Yield · 5-day momentum', spark: [4.35, 4.33, 4.31, 4.29, 4.28, 4.24] },
      { id: 'impulse', value: '-6.2%', detail: 'VIX 3-session change', spark: [18.1, 17.5, 17.1, 16.42] },
      { id: 'curve', value: '+3 bp', detail: '10Y − 2Y daily shift · Level +0.28%' },
    ],
  },
  mag7: {
    greenCount: 6,
    total: 7,
    avgChangePct: 0.78,
    label: 'Strong Tech Tailwind',
    items: [
      { symbol: 'NVDA', name: 'Nvidia', price: '146.20', change: '+1.85%', changePct: 1.85, direction: 'up' },
      { symbol: 'AAPL', name: 'Apple', price: '231.40', change: '+0.42%', changePct: 0.42, direction: 'up' },
      { symbol: 'MSFT', name: 'Microsoft', price: '428.10', change: '+0.64%', changePct: 0.64, direction: 'up' },
      { symbol: 'AMZN', name: 'Amazon', price: '211.80', change: '+0.95%', changePct: 0.95, direction: 'up' },
      { symbol: 'META', name: 'Meta', price: '589.50', change: '+1.12%', changePct: 1.12, direction: 'up' },
      { symbol: 'GOOGL', name: 'Alphabet', price: '179.30', change: '+0.58%', changePct: 0.58, direction: 'up' },
      { symbol: 'TSLA', name: 'Tesla', price: '332.10', change: '-0.12%', changePct: -0.12, direction: 'down' },
      { symbol: 'SMH', name: 'Semis ETF', price: '254.90', change: '+1.44%', changePct: 1.44, direction: 'up' },
    ],
  },
  addons: [
    { id: 'sentiment', value: '62 / 100', numValue: 62, detail: 'Greed · CNN Fear & Greed' },
    { id: 'breakeven', value: '2.31%', numValue: 2.31, detail: 'FRED · T10YIE · 10Y Breakeven', spark: [2.36, 2.35, 2.34, 2.32, 2.31] },
    { id: 'volatility', value: '0.89×', numValue: 0.89, detail: 'Contango (Calm) · VIX 16.4 / VIX3M 18.4' },
  ],
  cotBoard: [
    { id: 'nq', symbol: 'NQ', name: 'Nasdaq-100 E-mini', reportDate: '2026-11-17', longPct: 68.2, shortPct: 31.8, netPct: 18.4, wowContracts: 4210, wowPct: 1.4, percentile52w: 72, spark: [12, 14, 15.1, 16.2, 17, 18.4], group: 'Asset Managers' },
    { id: 'es', symbol: 'ES', name: 'S&P 500 E-mini', reportDate: '2026-11-17', longPct: 64.5, shortPct: 35.5, netPct: 14.1, wowContracts: 6150, wowPct: 0.9, percentile52w: 65, spark: [11, 12, 12.8, 13.4, 14.1], group: 'Asset Managers' },
    { id: 'xau', symbol: 'XAU', name: 'Gold (COMEX)', reportDate: '2026-11-17', longPct: 79.0, shortPct: 21.0, netPct: 26.8, wowContracts: 3820, wowPct: 1.8, percentile52w: 84, spark: [20, 22, 24, 25.1, 26.8], group: 'Managed Money' },
    { id: 'dxy', symbol: 'DXY', name: 'US Dollar Index', reportDate: '2026-11-17', longPct: 43.0, shortPct: 57.0, netPct: -8.2, wowContracts: -1940, wowPct: -1.1, percentile52w: 24, spark: [-4, -5.2, -6.5, -7.1, -8.2], group: 'Asset Managers' },
    { id: 'eurusd', symbol: 'EURUSD', name: 'Euro FX', reportDate: '2026-11-17', longPct: 58.6, shortPct: 41.4, netPct: 9.4, wowContracts: 2810, wowPct: 0.8, percentile52w: 61, spark: [5, 6.2, 7.8, 8.6, 9.4], group: 'Asset Managers' },
    { id: 'gbpusd', symbol: 'GBPUSD', name: 'British Pound', reportDate: '2026-11-17', longPct: 54.0, shortPct: 46.0, netPct: 4.8, wowContracts: 910, wowPct: 0.4, percentile52w: 52, spark: [2, 3.1, 3.8, 4.4, 4.8], group: 'Asset Managers' },
  ],
  seasonality: {
    month: 'November',
    monthIndex: 11,
    assets: {
      nq: { id: 'nq', symbol: 'NQ1!', month: 'November', winRate: 80, avgReturn: 4.12, samples: 10 },
      es: { id: 'es', symbol: 'ES1!', month: 'November', winRate: 80, avgReturn: 3.18, samples: 10 },
      xau: { id: 'xau', symbol: 'Gold', month: 'November', winRate: 50, avgReturn: 0.65, samples: 10 },
      dxy: { id: 'dxy', symbol: 'DXY', month: 'November', winRate: 40, avgReturn: -0.52, samples: 10 },
      eurusd: { id: 'eurusd', symbol: 'EURUSD', month: 'November', winRate: 60, avgReturn: 0.48, samples: 10 },
      gbpusd: { id: 'gbpusd', symbol: 'GBPUSD', month: 'November', winRate: 60, avgReturn: 0.72, samples: 10 },
    },
  },
  assets: [
    {
      id: 'nq', symbol: 'NQ', name: 'Nasdaq-100 Futures', category: 'Index', price: '24,186.25', change: '+0.62%', direction: 'up', trend: 'bullish',
      cotNet: '+18.4%', seasonality: '80% (+4.1%)', rawScore: 8, score: 83, bias: 'Strong Bullish', spark: [23600, 23740, 23810, 23940, 24020, 24186],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: 2, max: 2, reading: '+18.4% (72nd pct)', summary: 'Asset Managers · 68%L / 32%S · WoW +4,210' },
        { id: 'rates', label: 'Rates & Real Yields', score: 1, max: 2, reading: '10Y 5d -11bp · Real 10Y 1.93%', summary: 'Falling real yields tailwind' },
        { id: 'inflation', label: 'Inflation & Fed', score: 1, max: 2, reading: 'Core CPI 2.74% · 10Y BE 2.31%', summary: 'Cooling inflation supports risk' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: 2, max: 2, reading: 'Net Liq $6.12T (+48B) · HY 318bp', summary: 'Expanding liquidity / tight credit' },
        { id: 'volatility', label: 'Volatility & Risk', score: 2, max: 2, reading: 'VIX 16.4 · VIX/3M 0.89× · Mag7 6/7', summary: 'Low vol / contango tailwind' },
        { id: 'trend', label: 'Trend & Seasonality', score: 2, max: 2, reading: 'Trend Bullish · Nov 80% green (+4.1%)', summary: 'Trend & seasonality aligned' },
      ],
    },
    {
      id: 'es', symbol: 'ES', name: 'S&P 500 Futures', category: 'Index', price: '6,042.50', change: '+0.41%', direction: 'up', trend: 'bullish',
      cotNet: '+14.1%', seasonality: '80% (+3.2%)', rawScore: 7, score: 79, bias: 'Strong Bullish', spark: [5950, 5975, 5995, 6012, 6042],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: 1, max: 2, reading: '+14.1% (65th pct)', summary: 'Asset Managers · 65%L / 35%S' },
        { id: 'rates', label: 'Rates & Real Yields', score: 1, max: 2, reading: '10Y 5d -11bp', summary: 'Falling real yields tailwind' },
        { id: 'inflation', label: 'Inflation & Fed', score: 1, max: 2, reading: 'Core CPI 2.74%', summary: 'Cooling inflation supports risk' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: 2, max: 2, reading: 'Net Liq $6.12T · HY 318bp', summary: 'Expanding liquidity / tight credit' },
        { id: 'volatility', label: 'Volatility & Risk', score: 1, max: 2, reading: 'VIX 16.4 · VIX/3M 0.89×', summary: 'Low vol / contango tailwind' },
        { id: 'trend', label: 'Trend & Seasonality', score: 2, max: 2, reading: 'Trend Bullish · Nov 80% green', summary: 'Trend & seasonality aligned' },
      ],
    },
    {
      id: 'xau', symbol: 'XAU', name: 'Gold Futures (XAUUSD)', category: 'Metals', price: '2,684.40', change: '+0.55%', direction: 'up', trend: 'bullish',
      cotNet: '+26.8%', seasonality: '50% (+0.7%)', rawScore: 5, score: 71, bias: 'Strong Bullish', spark: [2610, 2630, 2642, 2655, 2684],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: 2, max: 2, reading: '+26.8% (84th pct)', summary: 'Managed Money · 79%L / 21%S' },
        { id: 'rates', label: 'Rates & Real Yields', score: 1, max: 2, reading: 'Real 10Y 1.93%', summary: 'Falling real yields tailwind' },
        { id: 'inflation', label: 'Inflation & Fed', score: 1, max: 2, reading: '10Y BE 2.31%', summary: 'Inflation hedge / dovish tailwind' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: 1, max: 2, reading: 'Net Liq $6.12T', summary: 'Expanding liquidity' },
        { id: 'volatility', label: 'Volatility & Risk', score: 0, max: 2, reading: 'VIX 16.4', summary: 'Calm risk environment' },
        { id: 'trend', label: 'Trend & Seasonality', score: 1, max: 2, reading: 'Trend Bullish · Nov 50%', summary: 'Bullish price structure' },
      ],
    },
    {
      id: 'eurusd', symbol: 'EURUSD', name: 'Euro / US Dollar', category: 'FX', price: '1.0842', change: '+0.24%', direction: 'up', trend: 'bullish',
      cotNet: '+9.4%', seasonality: '60% (+0.5%)', rawScore: 4, score: 67, bias: 'Bullish', spark: [1.074, 1.076, 1.079, 1.081, 1.0842],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: 1, max: 2, reading: '+9.4% (61st pct)', summary: 'Asset Managers · 59%L / 41%S' },
        { id: 'rates', label: 'Rates & Real Yields', score: 1, max: 2, reading: '10Y 5d -11bp', summary: 'Softer US yields support EUR' },
        { id: 'inflation', label: 'Inflation & Fed', score: 1, max: 2, reading: 'Core CPI 2.74%', summary: 'Cooling US inflation' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: 1, max: 2, reading: 'Net Liq $6.12T', summary: 'Risk-on backdrop' },
        { id: 'volatility', label: 'Volatility & Risk', score: 0, max: 2, reading: 'VIX 16.4', summary: 'Balanced FX vol' },
        { id: 'trend', label: 'Trend & Seasonality', score: 1, max: 2, reading: 'Trend Bullish · Nov 60%', summary: 'Constructive trend' },
      ],
    },
    {
      id: 'gbpusd', symbol: 'GBPUSD', name: 'British Pound / USD', category: 'FX', price: '1.2914', change: '+0.19%', direction: 'up', trend: 'mixed',
      cotNet: '+4.8%', seasonality: '60% (+0.7%)', rawScore: 2, score: 58, bias: 'Bullish', spark: [1.284, 1.286, 1.289, 1.288, 1.2914],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: 0, max: 2, reading: '+4.8% (52nd pct)', summary: 'Balanced institutional positioning' },
        { id: 'rates', label: 'Rates & Real Yields', score: 1, max: 2, reading: '10Y 5d -11bp', summary: 'Softer US yields' },
        { id: 'inflation', label: 'Inflation & Fed', score: 1, max: 2, reading: 'Core CPI 2.74%', summary: 'Cooling US inflation' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: 1, max: 2, reading: 'Net Liq $6.12T', summary: 'Risk-on backdrop' },
        { id: 'volatility', label: 'Volatility & Risk', score: 0, max: 2, reading: 'VIX 16.4', summary: 'Balanced FX vol' },
        { id: 'trend', label: 'Trend & Seasonality', score: 0, max: 2, reading: 'Trend Mixed · Nov 60%', summary: 'Mixed technical/seasonal' },
      ],
    },
    {
      id: 'dxy', symbol: 'DXY', name: 'US Dollar Index', category: 'FX', price: '101.46', change: '-0.22%', direction: 'down', trend: 'bearish',
      cotNet: '-8.2%', seasonality: '40% (-0.5%)', rawScore: -6, score: 25, bias: 'Strong Bearish', spark: [102.4, 102.2, 101.9, 101.7, 101.46],
      pillars: [
        { id: 'cot', label: 'COT Institutional', score: -2, max: 2, reading: '-8.2% (24th pct)', summary: 'Asset Managers net short USD' },
        { id: 'rates', label: 'Rates & Real Yields', score: -1, max: 2, reading: '10Y 5d -11bp', summary: 'Falling US yields weigh on DXY' },
        { id: 'inflation', label: 'Inflation & Fed', score: -1, max: 2, reading: 'Core CPI 2.74%', summary: 'Cooling inflation caps hawkish USD' },
        { id: 'liquidity', label: 'Liquidity & Credit', score: -1, max: 2, reading: 'Net Liq $6.12T', summary: 'Risk-on liquidity headwind for USD' },
        { id: 'volatility', label: 'Volatility & Risk', score: -1, max: 2, reading: 'VIX 16.4', summary: 'Low safe-haven USD demand' },
        { id: 'trend', label: 'Trend & Seasonality', score: -1, max: 2, reading: 'Trend Bearish · Nov 40%', summary: 'Bearish structure' },
      ],
    },
  ],
  calendar: [
    { date: new Date(Date.now() + 3 * 3600_000).toISOString(), event: 'US Initial Jobless Claims', actual: null, estimate: '218K', unit: '', tier1: false, surprise: null, nqImpact: 'watch', source: 'FMP' },
    { date: new Date(Date.now() + 27 * 3600_000).toISOString(), event: 'US Core PCE Price Index YoY', actual: null, estimate: '2.7%', unit: '%', tier1: true, surprise: null, nqImpact: 'watch', source: 'BEA' },
  ],
};

const SIZING_META = {
  standard: { label: 'STANDARD SIZE', tone: 'is-pos' },
  micro: { label: 'MICRO ONLY', tone: 'is-warn' },
  paused: { label: 'STAND DOWN · NEWS WINDOW', tone: 'is-neg' },
};

const number = 'tw:font-mono tw:tabular-nums';
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function biasTone(bias = '') {
  const b = bias.toLowerCase();
  if (b.includes('bullish') || b.includes('constructive')) return 'is-pos';
  if (b.includes('bearish')) return 'is-neg';
  return '';
}

function scoreColor(score) {
  if (score >= 65) return '#10b981';
  if (score >= 55) return '#34d399';
  if (score <= 35) return '#f43f5e';
  if (score <= 45) return '#fb7185';
  return '#93a39a';
}

function Sparkline({ data, color, width = 76, height = 22 }) {
  if (!Array.isArray(data) || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (width - 2) + 1;
    const y = height - 2 - ((v - min) / span) * (height - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const stroke = color || (data[data.length - 1] >= data[0] ? '#10b981' : '#f43f5e');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="tw:shrink-0" aria-hidden="true">
      <polyline fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

function Change({ reading }) {
  if (!reading?.change) return <span className="mx-muted">—</span>;
  const up = reading.direction === 'up';
  const down = reading.direction === 'down';
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <span className={`tw:inline-flex tw:items-center tw:gap-0.5 tw:text-xs tw:font-semibold ${number} ${up ? 'mx-pos' : down ? 'mx-neg' : 'mx-muted'}`}>
      <Icon size={13} aria-hidden="true" />{reading.change}
    </span>
  );
}

function parseCalMs(raw) {
  if (!raw) return NaN;
  const s = String(raw);
  const normalized = s.length === 16 && s.includes(' ') ? s.replace(' ', 'T') + ':00Z' : s;
  return Date.parse(normalized);
}

function formatCalCountdown(ms) {
  if (!Number.isFinite(ms)) return '';
  const diffMin = Math.round((ms - Date.now()) / 60000);
  if (diffMin < -30) return 'Released';
  if (diffMin <= 0) return 'LIVE';
  if (diffMin < 60) return `in ${diffMin}m`;
  if (diffMin < 1440) {
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${Math.ceil(diffMin / 1440)}d`;
}

export default function MatrixPage() {
  const bullpen = useBullpen();
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('nq');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'positioning' | 'calendar'
  const [calFilter, setCalFilter] = useState('week'); // 'today' | 'week' | 'all'
  const [briefState, setBriefState] = useState(''); // '' | 'sent' | 'copied'
  const [journalState, setJournalState] = useState(''); // '' | 'saving' | 'saved' | 'error'

  useEffect(() => {
    document.title = 'The Matrix — PrimusTrader';
    api('/session').then((s) => {
      if (s?.owner) setIsOwner(true);
      if (s?.authenticated) setAuthenticated(true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api('/matrix/snapshot', { signal: controller.signal }).then(({ snapshot: next }) => {
      if (controller.signal.aborted) return;
      setSnapshot(next);
      setStatus(next ? 'cached' : localSitePreview() ? 'demo' : 'unavailable');
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('unavailable');
    });
    return () => controller.abort();
  }, [attempt]);

  const onReload = () => {
    setStatus('loading');
    setRefreshNote('');
    setAttempt((v) => v + 1);
  };

  const onLiveRefresh = async () => {
    if (refreshingLive) return;
    setRefreshingLive(true);
    setRefreshNote('');
    try {
      const res = await api('/matrix/refresh', { method: 'POST' });
      if (res?.snapshot) {
        setSnapshot(res.snapshot);
        setStatus('cached');
        setRefreshNote('Snapshot refreshed live.');
      }
    } catch (err) {
      setRefreshNote(snapshot ? 'Refresh failed. Showing the last snapshot.' : (err?.message || 'Refresh failed.'));
    } finally {
      setRefreshingLive(false);
    }
  };

  const demo = status === 'demo';
  const data = demo ? DEMO_SNAPSHOT : snapshot;
  const unavailable = status === 'unavailable' || (!data && status !== 'loading');
  const asOf = data?.asOf ? new Date(data.asOf) : null;
  const freshness = matrixFreshness(data);

  const assets = useMemo(() => (Array.isArray(data?.assets) ? data.assets : []), [data?.assets]);
  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) || assets[0] || null,
    [assets, selectedAssetId],
  );
  const nqAsset = useMemo(() => assets.find((a) => a.id === 'nq') || assets[0] || null, [assets]);
  const cotBoard = useMemo(() => (Array.isArray(data?.cotBoard) ? data.cotBoard : []), [data?.cotBoard]);
  const seasonality = data?.seasonality || null;
  const mag7 = data?.mag7 || null;
  const sizingKey = data?.intraday?.sizing;
  const sizingStyle = SIZING_META[sizingKey] || { label: 'UNAVAILABLE', tone: '' };

  const allCalendarRows = useMemo(() => {
    const raw = Array.isArray(data?.calendar) ? data.calendar : [];
    return raw.map((ev, idx) => {
      const ms = parseCalMs(ev.date || ev.scheduled_at);
      const dayNy = Number.isFinite(ms)
        ? new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
        : String(ev.date || '').slice(0, 10);
      return {
        ...ev,
        id: `${ev.date || idx}:${ev.event || ev.name}`,
        title: ev.event || ev.name || 'US Release',
        ms,
        dayNy,
        countdown: formatCalCountdown(ms),
      };
    }).sort((a, b) => (a.ms || 0) - (b.ms || 0));
  }, [data?.calendar]);

  const calendarRows = useMemo(() => {
    const todayNy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const now = Date.now();
    if (calFilter === 'today') return allCalendarRows.filter((ev) => ev.dayNy === todayNy);
    if (calFilter === 'week') return allCalendarRows.filter((ev) => !Number.isFinite(ev.ms) || (ev.ms >= now - 12 * 3600_000 && ev.ms <= now + 7 * 86400_000));
    return allCalendarRows;
  }, [allCalendarRows, calFilter]);

  const nextCatalyst = useMemo(
    () => allCalendarRows.find((e) => !Number.isFinite(e.ms) || e.ms >= Date.now() - 30 * 60000) || null,
    [allCalendarRows],
  );

  const buildBriefText = () => {
    const vixT = (data?.tickers || []).find((t) => t.id === 'vix');
    const parts = [
      'MATRIX BRIEF',
      nqAsset ? `NQ ${nqAsset.bias} (${nqAsset.score}/100)` : '',
      `Sizing: ${sizingStyle.label}`,
      data?.intraday?.impliedMove?.label ? `Implied: ${data.intraday.impliedMove.label}` : vixT ? `VIX ${vixT.value}` : '',
      mag7?.total ? `Mag7 ${mag7.greenCount}/${mag7.total} Green` : '',
      nextCatalyst ? `Next: ${nextCatalyst.title} (${nextCatalyst.countdown || nextCatalyst.dayNy})` : 'No immediate red-folder',
    ].filter(Boolean);
    return parts.join(' · ').slice(0, 395);
  };

  const sendPreMarketBrief = async () => {
    const brief = buildBriefText();
    if (bullpen?.connected && bullpen?.inCall) {
      const ok = await bullpen.send('chat', { text: brief });
      if (ok) {
        setBriefState('sent');
        setTimeout(() => setBriefState(''), 3000);
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(brief);
      setBriefState('copied');
      setTimeout(() => setBriefState(''), 3000);
    } catch {}
  };

  const sendToTodayJournal = async () => {
    if (!data || journalState === 'saving') return;
    const brief = buildBriefText();
    if (!authenticated) {
      try {
        await navigator.clipboard.writeText(brief);
        setJournalState('saved');
        setTimeout(() => setJournalState(''), 3000);
      } catch {}
      return;
    }
    setJournalState('saving');
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const existing = await api(`/journal/${today}`);
      const prevPlan = (existing?.plan || '').trim();
      const line = `[Matrix] ${brief}`;
      const nextPlan = prevPlan.includes(line) ? prevPlan : (prevPlan ? `${prevPlan}\n\n${line}` : line);
      await api(`/journal/${today}`, { method: 'PUT', body: { plan: nextPlan.slice(0, 12000) } });
      setJournalState('saved');
      setTimeout(() => setJournalState(''), 4000);
    } catch {
      setJournalState('error');
      setTimeout(() => setJournalState(''), 3000);
    }
  };

  if (status === 'loading' && !snapshot) {
    return (
      <div className="pt-site matrix-page">
        <PrimusHeader active="matrix" />
        <MatrixLoading />
      </div>
    );
  }

  const addonCards = [
    ...(data?.swing?.metrics || []).filter((m) => ['fed', 'credit', 'cpi'].includes(m.id)).map((m) => ({
      id: m.id,
      label: m.id === 'fed' ? 'Fed Net Liquidity' : m.id === 'credit' ? 'HY Credit Spread' : 'Core CPI YoY',
      value: m.value,
      change: m.change,
      direction: m.direction,
      detail: m.detail,
      spark: m.spark,
      icon: m.id === 'fed' ? Zap : m.id === 'credit' ? Flame : Activity,
    })),
    ...(data?.addons || []).map((a) => ({
      id: a.id,
      label: a.id === 'sentiment' ? 'Fear & Greed / Risk' : a.id === 'breakeven' ? '10Y Breakeven' : 'VIX / VIX3M Structure',
      value: a.value,
      detail: a.detail,
      spark: a.spark,
      icon: a.id === 'sentiment' ? Gauge : a.id === 'breakeven' ? Activity : Layers3,
    })),
  ];

  return (
    <div className="pt-site matrix-page">
      <PrimusHeader active="matrix" />
      <main className="matrix-terminal tw:min-h-screen">
        <div className="tw:mx-auto tw:grid tw:max-w-[1520px] tw:gap-3.5 tw:px-3 tw:py-5 tw:sm:px-6">

          {/* Command Header */}
          <header className="tw:flex tw:flex-wrap tw:items-end tw:justify-between tw:gap-3 tw:border-b mx-divider tw:pb-3.5">
            <div>
              <p className="tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-widest mx-muted">PrimusTrader / Macro Desk</p>
              <h1 className="tw:text-2xl tw:font-semibold tw:tracking-tight">The Matrix</h1>
              <p className="tw:text-xs mx-muted">NQ · ES · Gold · DXY · EURUSD · GBPUSD — Multi-Asset Bias, COT &amp; Session Risk</p>
            </div>
            <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
              <div aria-label="Data freshness" className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                <span className={`mx-badge ${demo || freshness.stale ? 'is-warn' : ''}`}>
                  {demo ? 'Demo data' : unavailable ? 'Unavailable' : freshness.label}
                </span>
                {!demo && !unavailable && freshness.stale && (
                  <span className="tw:text-xs mx-warn">Check freshness before using this snapshot.</span>
                )}
              </div>
              {!demo && asOf && Number.isFinite(asOf.getTime()) && (
                <time dateTime={asOf.toISOString()} className={`tw:inline-flex tw:items-center tw:gap-1 tw:text-xs ${number} mx-muted`}>
                  <Clock3 size={13} aria-hidden="true" />{dateFormat.format(asOf)} ET
                </time>
              )}
              {data && (
                <button type="button" className="mx-btn" onClick={sendPreMarketBrief}>
                  {briefState === 'sent' || briefState === 'copied' ? <Check size={13} /> : bullpen?.inCall ? <Send size={13} /> : <Copy size={13} />}
                  {briefState === 'sent' ? 'Sent to Floor' : briefState === 'copied' ? 'Copied Brief' : bullpen?.inCall ? 'Send to Floor' : 'Copy Brief'}
                </button>
              )}
              {isOwner ? (
                <button type="button" className="mx-btn is-primary" onClick={onLiveRefresh} disabled={refreshingLive}>
                  <RefreshCw size={13} className={refreshingLive ? 'mx-spin' : ''} />
                  {refreshingLive ? 'Refreshing…' : 'Refresh Now'}
                </button>
              ) : (
                <button type="button" className="mx-btn" onClick={onReload} disabled={status === 'loading'}>
                  <RefreshCw size={13} className={status === 'loading' ? 'mx-spin' : ''} />
                  Reload
                </button>
              )}
            </div>
          </header>

          {demo && (
            <p className="mx-badge is-warn tw:justify-start tw:px-3 tw:py-2 tw:text-xs tw:font-normal tw:whitespace-normal">
              Sample preview data. In production, click Refresh Now or wait for the scheduled pre-market sync to load live FRED, CFTC COT, and market quotes.
            </p>
          )}
          {refreshNote && (
            <p role="status" className="mx-subcard tw:px-3 tw:py-2 tw:text-xs mx-ink-2">
              {refreshNote}
            </p>
          )}
          {unavailable && (
            <div role="status" className="mx-card tw:flex tw:items-center tw:justify-between tw:gap-2 tw:p-3 tw:text-xs">
              <span>{data ? 'Refresh failed. Showing the last snapshot.' : 'Macro snapshot is not populated yet. Click Refresh Now to pull live data.'}</span>
              <button type="button" className="mx-btn" onClick={isOwner ? onLiveRefresh : onReload}>Retry</button>
            </div>
          )}

          {/* 1. Live Macro Ticker Strip (Always visible) */}
          <section aria-label="Macro ticker" className="tw:grid tw:grid-cols-2 tw:gap-2.5 tw:sm:grid-cols-3 tw:lg:grid-cols-6">
            {TOP_TICKERS.map(({ id, label, name }) => {
              const reading = (data?.tickers || []).find((item) => item.id === id);
              return (
                <article key={id} className="mx-card tw:p-3">
                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-1">
                    <h2 className="tw:text-xs tw:font-semibold">{label}</h2>
                    <Change reading={reading} />
                  </div>
                  <div className="tw:mt-2 tw:flex tw:items-end tw:justify-between tw:gap-2">
                    <strong className={`tw:text-base mx-ink ${number}`}>{reading?.value ?? '—'}</strong>
                    <Sparkline data={reading?.spark} width={64} height={20} />
                  </div>
                  <p className="tw:mt-1 tw:truncate tw:text-[11px] mx-muted">{reading?.detail || name}</p>
                </article>
              );
            })}
          </section>

          {/* 2. 3-Second Morning Decision Strip */}
          {data && (
            <section className="mx-card mx-decision-strip" aria-label="Morning decision summary">
              <div className="mx-decision-cell">
                <span className="mx-decision-label">Session Sizing Gate</span>
                <div>
                  <span className={`mx-badge ${sizingStyle.tone} ${number}`}>
                    <span className={`mx-dot ${sizingStyle.tone}`} />
                    {sizingStyle.label}
                  </span>
                </div>
              </div>
              <div className="mx-decision-cell">
                <span className="mx-decision-label">NQ Bias &amp; Implied Move</span>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                  {nqAsset && (
                    <span className={`mx-badge ${biasTone(nqAsset.bias)} ${number}`}>
                      {nqAsset.bias} · {nqAsset.score}/100
                    </span>
                  )}
                  <span className={`tw:text-xs tw:font-semibold mx-ink ${number}`}>
                    {data?.intraday?.impliedMove?.label ?? '—'}
                  </span>
                </div>
              </div>
              <div className="mx-decision-cell">
                <span className="mx-decision-label">Next Catalyst</span>
                <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:text-xs">
                  {nextCatalyst ? (
                    <>
                      {nextCatalyst.tier1 && <span className="mx-badge is-neg tw:px-1.5 tw:py-0 tw:text-[10px]">RED</span>}
                      <strong className="tw:truncate mx-ink">{nextCatalyst.title}</strong>
                      {nextCatalyst.countdown && <span className={`mx-badge ${number} tw:text-[10px]`}>{nextCatalyst.countdown}</span>}
                    </>
                  ) : (
                    <span className="mx-muted">No immediate high-impact US release</span>
                  )}
                </div>
              </div>
              <div className="mx-decision-actions">
                <button type="button" className="mx-btn is-primary" onClick={sendToTodayJournal} disabled={journalState === 'saving'}>
                  {journalState === 'saved' ? <Check size={13} /> : <ArrowUpRight size={13} />}
                  {journalState === 'saving'
                    ? 'Sending…'
                    : journalState === 'saved'
                      ? (authenticated ? 'Added to Journal' : 'Copied for Journal')
                      : journalState === 'error'
                        ? 'Try again'
                        : 'Send to Today’s Journal'}
                </button>
                {journalState === 'saved' && authenticated && (
                  <a href="/journal" className="mx-btn">Open Journal ↗</a>
                )}
              </div>
            </section>
          )}

          {/* 3. Section Tabs */}
          <div className="mx-tabs" role="tablist" aria-label="Matrix desk sections">
            {[
              { id: 'overview', label: 'Overview & Bias' },
              { id: 'positioning', label: 'Positioning & Liquidity' },
              { id: 'calendar', label: 'Catalyst Calendar', count: allCalendarRows.length },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <span>{tab.label}</span>
                {tab.count > 0 && <span className={`mx-tab-count ${number}`}>{tab.count}</span>}
              </button>
            ))}
          </div>

          {/* TAB 1: Overview & Bias */}
          {activeTab === 'overview' && (
            <div className="tw:grid tw:gap-3.5" role="tabpanel" aria-label="Overview and Bias">
              {/* Multi-Asset Bias Scoreboard + Interactive Pillar Breakdown */}
              <section className="tw:grid tw:gap-3.5 tw:lg:grid-cols-12" aria-label="Multi-asset bias scoreboard">
                <div className="mx-card tw:overflow-hidden tw:lg:col-span-7">
                  <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                    <div className="tw:flex tw:items-center tw:gap-2">
                      <Compass size={16} className="mx-pos" aria-hidden="true" />
                      <div>
                        <h2 className="tw:text-sm tw:font-semibold">Multi-Asset Bias Scoreboard</h2>
                        <p className="tw:text-xs mx-muted">Click any market to inspect its 6 weighted macro, COT &amp; seasonal pillars</p>
                      </div>
                    </div>
                    <span className="tw:text-[11px] mx-muted">Score 0–100 · Raw −12 to +12</span>
                  </header>
                  <div className="tw:overflow-x-auto">
                    {assets.length ? (
                      <table className="tw:w-full tw:border-collapse tw:text-left tw:text-xs">
                        <thead>
                          <tr className="tw:border-b mx-divider tw:text-[11px] tw:uppercase tw:tracking-wider mx-muted">
                            <th className="tw:px-4 tw:py-2.5">Asset</th>
                            <th className="tw:px-2 tw:py-2.5">Price</th>
                            <th className="tw:px-2 tw:py-2.5">Bias</th>
                            <th className="tw:px-2 tw:py-2.5">Score</th>
                            <th className="tw:px-2 tw:py-2.5">COT Net</th>
                            <th className="tw:px-3 tw:py-2.5">Seasonality</th>
                          </tr>
                        </thead>
                        <tbody>
                          {assets.map((asset) => {
                            const active = selectedAsset?.id === asset.id;
                            return (
                              <tr
                                key={asset.id}
                                className={`mx-table-row tw:border-b mx-divider ${active ? 'mx-row-active' : ''}`}
                                onClick={() => setSelectedAssetId(asset.id)}
                              >
                                <td className="tw:px-4 tw:py-2.5">
                                  <div className="tw:font-semibold mx-ink">{asset.symbol}</div>
                                  <div className="tw:text-[11px] mx-muted">{asset.category}</div>
                                </td>
                                <td className="tw:px-2 tw:py-2.5">
                                  <div className={`tw:font-semibold mx-ink ${number}`}>{asset.price}</div>
                                  <Change reading={asset} />
                                </td>
                                <td className="tw:px-2 tw:py-2.5">
                                  <span className={`mx-badge ${biasTone(asset.bias)}`}>{asset.bias}</span>
                                </td>
                                <td className="tw:min-w-[120px] tw:px-2 tw:py-2.5">
                                  <div className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                                    <strong className={number}>{asset.score}</strong>
                                    <span className={`tw:text-[11px] ${number} mx-muted`}>
                                      {asset.rawScore > 0 ? `+${asset.rawScore}` : asset.rawScore} / 12
                                    </span>
                                  </div>
                                  <div className="mx-score-track tw:mt-1">
                                    <div className="mx-score-fill" style={{ width: `${asset.score}%`, background: scoreColor(asset.score) }} />
                                  </div>
                                </td>
                                <td className={`tw:px-2 tw:py-2.5 tw:font-semibold ${number}`}>{asset.cotNet}</td>
                                <td className={`tw:px-3 tw:py-2.5 ${number} mx-muted`}>{asset.seasonality}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <p className="tw:p-4 tw:text-xs mx-muted">No multi-asset scores yet. Click Refresh Now to compute all 6 markets.</p>
                    )}
                  </div>
                </div>

                {/* Transparent Pillar Breakdown Panel */}
                <div className="mx-card tw:flex tw:flex-col tw:lg:col-span-5">
                  <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                    <div>
                      <h2 className="tw:text-sm tw:font-semibold">
                        {selectedAsset ? `${selectedAsset.symbol} · Pillar Breakdown` : 'Pillar Breakdown'}
                      </h2>
                      <p className="tw:text-xs mx-muted">
                        {selectedAsset ? `${selectedAsset.name} — exact score drivers` : 'Select a market to inspect'}
                      </p>
                    </div>
                    {selectedAsset && (
                      <div className="tw:flex tw:items-center tw:gap-2">
                        <Sparkline data={selectedAsset.spark} width={60} height={20} />
                        <span className={`mx-badge ${biasTone(selectedAsset.bias)} ${number}`}>
                          {selectedAsset.score} / 100
                        </span>
                      </div>
                    )}
                  </header>
                  <div className="tw:flex-1 tw:px-4">
                    {selectedAsset?.pillars?.length ? selectedAsset.pillars.map((p) => {
                      const pct = (Math.abs(p.score) / (p.max || 2)) * 50;
                      const pos = p.score > 0;
                      const neg = p.score < 0;
                      return (
                        <div key={p.id} className="tw:border-b mx-divider tw:py-2.5 last:tw:border-b-0">
                          <div className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:text-xs">
                            <span className="tw:font-semibold mx-ink">{p.label}</span>
                            <span className={`mx-badge ${pos ? 'is-pos' : neg ? 'is-neg' : ''} ${number} tw:px-1.5 tw:py-0`}>
                              {pos ? `+${p.score}` : p.score}
                            </span>
                          </div>
                          <div className="mx-pillar-bar tw:mt-1.5">
                            <span className="mx-pillar-mid" />
                            {p.score !== 0 && (
                              <span
                                className="mx-pillar-seg"
                                style={{
                                  left: pos ? '50%' : `${50 - pct}%`,
                                  width: `${pct}%`,
                                  background: pos ? '#10b981' : '#f43f5e',
                                }}
                              />
                            )}
                          </div>
                          <div className="tw:mt-1 tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-1 tw:text-[11px]">
                            <span className={`mx-ink-2 ${number}`}>{p.reading}</span>
                            <span className="mx-muted">{p.summary}</span>
                          </div>
                        </div>
                      );
                    }) : (
                      <p className="tw:py-4 tw:text-xs mx-muted">No pillar readings available yet.</p>
                    )}
                  </div>
                </div>
              </section>

              {/* Intraday Session Playbook + Mag 7 & Semis Breadth */}
              <div className="tw:grid tw:gap-3.5 tw:lg:grid-cols-12">
                <section className="mx-card tw:flex tw:flex-col tw:lg:col-span-7" aria-label="NQ intraday session playbook">
                  <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                    <div className="tw:flex tw:items-center tw:gap-2">
                      <ShieldCheck size={16} className="mx-pos" aria-hidden="true" />
                      <div>
                        <h2 className="tw:text-sm tw:font-semibold">NQ / MNQ Intraday Session Playbook</h2>
                        <p className="tw:text-xs mx-muted">Pre-market sizing gate &amp; implied NY volatility range</p>
                      </div>
                    </div>
                    <span className={`mx-badge ${sizingStyle.tone} ${number}`}>
                      <span className={`mx-dot ${sizingStyle.tone}`} />
                      {sizingStyle.label}
                    </span>
                  </header>

                  <div className="tw:grid tw:gap-3 tw:p-4">
                    <div className="tw:grid tw:gap-2.5 tw:sm:grid-cols-2">
                      <div className="mx-subcard tw:p-3">
                        <span className="tw:text-[11px] tw:uppercase tw:tracking-wider mx-muted">Implied NQ Daily Move (VIX)</span>
                        <div className={`tw:mt-1 tw:text-base tw:font-bold mx-ink ${number}`}>
                          {data?.intraday?.impliedMove?.label ?? '—'}
                        </div>
                        <p className="tw:mt-1 tw:text-[11px] mx-muted">
                          VIX / √252 expected 1σ NY session swing — calibrate stop width accordingly.
                        </p>
                      </div>
                      <div className="mx-subcard tw:p-3">
                        <span className="tw:text-[11px] tw:uppercase tw:tracking-wider mx-muted">Active Sizing Rules</span>
                        <ul className="tw:mt-1.5 tw:list-none tw:space-y-1 tw:p-0 tw:text-xs mx-ink-2">
                          {(data?.intraday?.reasons || ['No sizing reasons computed yet.']).map((reason, idx) => (
                            <li key={idx} className="tw:flex tw:items-start tw:gap-1.5">
                              <AlertTriangle size={12} className="tw:mt-0.5 tw:shrink-0 mx-warn" />
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="tw:grid tw:gap-2 tw:sm:grid-cols-3">
                      {[
                        { id: 'yield', label: '10Y Yield · 5d Momentum' },
                        { id: 'impulse', label: 'VIX · 3-Session Impulse' },
                        { id: 'curve', label: '10Y − 2Y Yield Curve' },
                      ].map((m) => {
                        const r = (data?.intraday?.metrics || []).find((x) => x.id === m.id);
                        return (
                          <div key={m.id} className="mx-subcard tw:flex tw:items-center tw:justify-between tw:gap-2 tw:px-3 tw:py-2.5">
                            <div className="tw:min-w-0">
                              <div className="tw:text-[11px] mx-muted">{m.label}</div>
                              <div className={`tw:mt-0.5 tw:text-sm tw:font-semibold mx-ink ${number}`}>{r?.value ?? '—'}</div>
                            </div>
                            <Sparkline data={r?.spark} width={56} height={18} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="mx-card tw:flex tw:flex-col tw:lg:col-span-5" aria-label="Mag 7 and Semiconductors breadth">
                  <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                    <div className="tw:flex tw:items-center tw:gap-2">
                      <BarChart3 size={16} className="mx-pos" aria-hidden="true" />
                      <div>
                        <h2 className="tw:text-sm tw:font-semibold">Mag 7 + Semis Breadth</h2>
                        <p className="tw:text-xs mx-muted">~45% of Nasdaq-100 weight</p>
                      </div>
                    </div>
                    {mag7 && (
                      <span className={`mx-badge ${mag7.greenCount >= 4 ? 'is-pos' : 'is-neg'} ${number}`}>
                        {mag7.greenCount}/{mag7.total} Green · {mag7.avgChangePct >= 0 ? '+' : ''}{mag7.avgChangePct}%
                      </span>
                    )}
                  </header>
                  <div className="tw:flex-1 tw:p-3">
                    {mag7?.items?.length ? (
                      <>
                        <div className="tw:mb-2.5 tw:flex tw:items-center tw:justify-between tw:text-xs">
                          <span className="mx-muted">{mag7.label}</span>
                          <div className="tw:flex tw:gap-1">
                            {mag7.items.slice(0, 7).map((it) => (
                              <span
                                key={it.symbol}
                                title={`${it.symbol}: ${it.change}`}
                                className={`tw:h-2 tw:w-5 tw:rounded-sm ${it.changePct > 0 ? 'tw:bg-emerald-500' : it.changePct < 0 ? 'tw:bg-rose-500' : 'tw:bg-zinc-500'}`}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:sm:grid-cols-4">
                          {mag7.items.map((item) => (
                            <div key={item.symbol} className="mx-subcard tw:p-2.5">
                              <div className="tw:flex tw:items-center tw:justify-between tw:gap-1">
                                <strong className="tw:text-xs mx-ink">{item.symbol}</strong>
                                <span className={`tw:text-[11px] tw:font-semibold ${number} ${item.direction === 'up' ? 'mx-pos' : item.direction === 'down' ? 'mx-neg' : 'mx-muted'}`}>
                                  {item.change}
                                </span>
                              </div>
                              <div className={`tw:mt-1 tw:text-xs ${number} mx-muted`}>{item.price}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="tw:p-2 tw:text-xs mx-muted">Run Refresh Now to load live Mag 7 &amp; SMH breadth.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: Positioning & Liquidity */}
          {activeTab === 'positioning' && (
            <div className="tw:grid tw:gap-3.5 tw:lg:grid-cols-12" role="tabpanel" aria-label="Positioning and Liquidity">
              <section className="mx-card tw:lg:col-span-6" aria-label="COT institutional positioning">
                <header className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                  <div className="tw:flex tw:items-center tw:gap-2">
                    <Layers3 size={16} className="mx-pos" aria-hidden="true" />
                    <div>
                      <h2 className="tw:text-sm tw:font-semibold">COT Institutional Positioning</h2>
                      <p className="tw:text-xs mx-muted">CFTC Long vs Short · WoW contract shift · 52-week crowdedness</p>
                    </div>
                  </div>
                  {cotBoard[0]?.reportDate && (
                    <span className={`tw:text-[11px] ${number} mx-muted`}>As of {cotBoard[0].reportDate}</span>
                  )}
                </header>
                <div className="tw:px-4">
                  {cotBoard.length ? cotBoard.map((row) => {
                    const extreme = row.percentile52w >= 80 || row.percentile52w <= 20;
                    return (
                      <div key={row.id} className="tw:border-b mx-divider tw:py-3 last:tw:border-b-0">
                        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:text-xs">
                          <div className="tw:flex tw:items-center tw:gap-2">
                            <strong className="mx-ink">{row.symbol}</strong>
                            <span className="mx-muted">{row.name}</span>
                            {extreme && (
                              <span className="mx-badge is-warn tw:px-1.5 tw:py-0 tw:text-[10px]">
                                {row.percentile52w >= 80 ? 'CROWDED LONG' : 'CROWDED SHORT'}
                              </span>
                            )}
                          </div>
                          <div className={`tw:flex tw:items-center tw:gap-3 ${number}`}>
                            <span className={row.wowContracts >= 0 ? 'mx-pos' : 'mx-neg'}>
                              WoW {row.wowContracts >= 0 ? '+' : ''}{row.wowContracts.toLocaleString()}
                            </span>
                            <span className="mx-muted">{row.percentile52w}th pct</span>
                            <Sparkline data={row.spark} width={52} height={16} />
                          </div>
                        </div>
                        <div className="mx-cot-bar tw:mt-2">
                          <div className="mx-cot-long" style={{ width: `${row.longPct}%` }} />
                          <div className="mx-cot-short" style={{ width: `${row.shortPct}%` }} />
                        </div>
                        <div className={`tw:mt-1 tw:flex tw:justify-between tw:text-[11px] ${number}`}>
                          <span className="mx-pos">Long {row.longPct.toFixed(1)}%</span>
                          <span className="mx-muted">Net {row.netPct >= 0 ? '+' : ''}{row.netPct.toFixed(1)}% OI</span>
                          <span className="mx-neg">Short {row.shortPct.toFixed(1)}%</span>
                        </div>
                      </div>
                    );
                  }) : (
                    <p className="tw:py-4 tw:text-xs mx-muted">No COT board cached yet. Click Refresh Now to fetch CFTC data.</p>
                  )}
                </div>
              </section>

              <div className="tw:flex tw:flex-col tw:gap-3.5 tw:lg:col-span-6">
                <section className="mx-card" aria-label="Historical monthly seasonality">
                  <header className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:px-4 tw:py-3">
                    <div>
                      <h2 className="tw:text-sm tw:font-semibold">
                        10-Year Seasonality · {seasonality?.month || new Date().toLocaleString('en-US', { month: 'long' })}
                      </h2>
                      <p className="tw:text-xs mx-muted">Historical monthly green-close win rate &amp; average return</p>
                    </div>
                  </header>
                  <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:p-3 tw:sm:grid-cols-3">
                    {seasonality?.assets ? Object.values(seasonality.assets).map((s) => {
                      const bullish = s.winRate >= 60 && s.avgReturn >= 0;
                      const bearish = s.winRate <= 40 && s.avgReturn < 0;
                      return (
                        <div key={s.id} className="mx-subcard tw:p-2.5">
                          <div className="tw:flex tw:items-center tw:justify-between tw:text-xs">
                            <strong>{s.symbol}</strong>
                            <span className={`${number} ${bullish ? 'mx-pos' : bearish ? 'mx-neg' : 'mx-muted'}`}>
                              {s.avgReturn >= 0 ? '+' : ''}{s.avgReturn}%
                            </span>
                          </div>
                          <div className="mx-score-track tw:mt-2">
                            <div className="mx-score-fill" style={{ width: `${s.winRate}%`, background: bullish ? '#10b981' : bearish ? '#f43f5e' : '#71717a' }} />
                          </div>
                          <div className={`tw:mt-1 tw:flex tw:justify-between tw:text-[11px] mx-muted ${number}`}>
                            <span>{s.winRate}% green</span>
                            <span>{s.samples}y</span>
                          </div>
                        </div>
                      );
                    }) : (
                      <p className="tw:col-span-full tw:p-1 tw:text-xs mx-muted">Run Refresh Now to compute 10-year monthly seasonality.</p>
                    )}
                  </div>
                </section>

                <section className="mx-card tw:flex-1" aria-label="Macro liquidity and volatility addons">
                  <header className="tw:border-b mx-divider tw:px-4 tw:py-3">
                    <h2 className="tw:text-sm tw:font-semibold">Macro Liquidity, Credit &amp; Volatility</h2>
                    <p className="tw:text-xs mx-muted">True Fed Net Liquidity (WALCL − TGA − RRP), spreads &amp; risk sentiment</p>
                  </header>
                  <div className="tw:grid tw:grid-cols-2 tw:gap-2 tw:p-3 tw:sm:grid-cols-3">
                    {addonCards.length ? addonCards.map((card) => {
                      const Icon = card.icon;
                      return (
                        <article key={card.id} className="mx-subcard tw:p-2.5">
                          <div className="tw:flex tw:items-center tw:gap-1.5 tw:text-[11px] mx-muted">
                            <Icon size={13} aria-hidden="true" />
                            <span className="tw:truncate">{card.label}</span>
                          </div>
                          <div className="tw:mt-1.5 tw:flex tw:items-end tw:justify-between tw:gap-1">
                            <strong className={`tw:text-sm mx-ink ${number}`}>{card.value ?? '—'}</strong>
                            <Sparkline data={card.spark} width={48} height={16} />
                          </div>
                          {card.change && <div className="tw:mt-0.5"><Change reading={card} /></div>}
                          <p className="tw:mt-1 tw:line-clamp-2 tw:text-[10px] mx-muted">{card.detail || '—'}</p>
                        </article>
                      );
                    }) : (
                      <p className="tw:col-span-full tw:p-1 tw:text-xs mx-muted">No macro addons cached yet.</p>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: Catalyst Calendar */}
          {activeTab === 'calendar' && (
            <section className="mx-card tw:p-4 tw:text-xs" role="tabpanel" aria-label="Economic calendar">
              <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:border-b mx-divider tw:pb-3">
                <div className="tw:flex tw:items-center tw:gap-2">
                  <CalendarClock size={16} className="mx-pos" aria-hidden="true" />
                  <div>
                    <h2 className="tw:text-sm tw:font-semibold">High-Impact US Economic Calendar</h2>
                    <p className="tw:text-xs mx-muted">Scheduled catalysts with Beat/Miss surprise &amp; NQ directional impact</p>
                  </div>
                </div>
                <div className="tw:flex tw:items-center tw:gap-1" role="group" aria-label="Calendar range">
                  {[
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This Week' },
                    { id: 'all', label: 'All' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`mx-btn ${calFilter === tab.id ? 'is-primary' : ''}`}
                      onClick={() => setCalFilter(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {calendarRows.length > 0 ? (
                <ul className="tw:mt-2 tw:list-none tw:p-0">
                  {calendarRows.map((event) => (
                    <li key={event.id} className="tw:grid tw:items-center tw:gap-2 tw:border-b mx-divider tw:py-2.5 last:tw:border-b-0 tw:sm:grid-cols-12">
                      <div className="tw:flex tw:items-center tw:gap-2 tw:sm:col-span-5">
                        {event.tier1 && <span className="mx-badge is-neg tw:px-1.5 tw:py-0 tw:text-[10px]">RED</span>}
                        <span className="tw:font-semibold mx-ink">{event.title}</span>
                      </div>
                      <div className={`tw:sm:col-span-3 ${number} mx-muted`}>
                        {Number.isFinite(event.ms) ? `${dateFormat.format(new Date(event.ms))} ET` : event.date}
                        {event.countdown && (
                          <span className={`tw:ml-2 mx-badge ${event.countdown === 'LIVE' ? 'is-neg' : ''} tw:text-[10px]`}>
                            {event.countdown}
                          </span>
                        )}
                      </div>
                      <div className={`tw:sm:col-span-2 ${number}`}>
                        Act <b>{event.actual ?? '—'}</b> · Est {event.estimate ?? '—'} {event.unit ?? ''}
                      </div>
                      <div className="tw:flex tw:items-center tw:gap-1.5 tw:sm:col-span-2 tw:sm:justify-end">
                        {event.surprise && (
                          <span className={`mx-badge ${event.surprise === 'beat' ? 'is-warn' : ''} tw:uppercase tw:text-[10px]`}>
                            {event.surprise}
                          </span>
                        )}
                        {event.nqImpact && event.nqImpact !== 'watch' && (
                          <span className={`mx-badge ${event.nqImpact === 'bullish' ? 'is-pos' : event.nqImpact === 'bearish' ? 'is-neg' : ''} tw:text-[10px]`}>
                            NQ {event.nqImpact === 'bullish' ? 'Tailwind' : event.nqImpact === 'bearish' ? 'Headwind' : 'Neutral'}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tw:py-4 mx-muted">
                  {calFilter === 'today' ? 'No high-impact US releases scheduled for today.' : 'No high-impact US releases in this window.'}
                </p>
              )}

              <div className="tw:mt-3 tw:flex tw:flex-wrap tw:gap-4 tw:border-t mx-divider tw:pt-2.5">
                <a className="mx-link" href="https://www.bls.gov/schedule/" target="_blank" rel="noopener noreferrer">BLS · CPI &amp; jobs ↗</a>
                <a className="mx-link" href="https://www.bea.gov/news/schedule" target="_blank" rel="noopener noreferrer">BEA · GDP &amp; PCE ↗</a>
                <a className="mx-link" href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noopener noreferrer">Federal Reserve · FOMC ↗</a>
              </div>
            </section>
          )}

          {!demo && data && (
            <p className="tw:text-[11px] mx-muted">
              Uses FRED®, CFTC public COT filings, and public market feeds. Stored snapshot — verify timestamp before live execution.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
