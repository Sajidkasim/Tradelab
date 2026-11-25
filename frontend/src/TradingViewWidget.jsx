import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Radio } from 'lucide-react';

// Official TradingView embeds are isolated from the signed-in Primus origin.
// No API keys, private trades or journal text are sent to the provider.
export default function TradingViewWidget({ kind, theme = 'light', variant = 'default', height = 480 }) {
  const [loaded, setLoaded] = useState(false);
  const [active, setActive] = useState(false);
  const ref = useRef();
  const calendar = kind === 'calendar';
  const isMatrix = variant === 'matrix';
  const link = calendar ? 'https://www.tradingview.com/economic-calendar/' : 'https://www.tradingview.com/news/';

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const configuration = calendar
    ? {
        colorTheme: theme,
        isTransparent: isMatrix,
        locale: 'en',
        countryFilter: 'us,gb,eu',
        importanceFilter: '0,1',
        width: '100%',
        height,
      }
    : {
        feedMode: 'all_symbols',
        displayMode: 'regular',
        colorTheme: theme,
        isTransparent: isMatrix,
        locale: 'en',
        width: '100%',
        height,
      };

  const darkBg = isMatrix ? '#18201d' : '#2a2d30';
  const lightBg = '#ffffff';
  const darkInk = isMatrix ? '#eef2ec' : '#edf0e5';
  const lightInk = isMatrix ? '#17231d' : '#17271f';
  const darkLink = isMatrix ? '#c3f079' : '#c0d89f';
  const lightLink = isMatrix ? '#2f6b4f' : '#506c54';

  const source = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;height:100%;background:${theme === 'dark' ? darkBg : lightBg};color:${theme === 'dark' ? darkInk : lightInk};font:12px Inter,Arial,sans-serif}a{color:${theme === 'dark' ? darkLink : lightLink};text-decoration:none}a:hover{text-decoration:underline}.tradingview-widget-container{height:100%}.tradingview-widget-container__widget{height:calc(100% - 28px)}.tradingview-widget-copyright{text-align:center;padding:5px}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="${link}" target="_blank" rel="noopener">${calendar ? 'Economic Calendar' : 'Market news'} by TradingView</a></div><script src="https://s3.tradingview.com/external-embedding/${calendar ? 'embed-widget-events.js' : 'embed-widget-timeline.js'}" async>${JSON.stringify(configuration)}</script></div></body></html>`;

  const wrapClass = isMatrix ? 'mx-market-widget' : 'pt-market-widget';
  const loadingClass = isMatrix ? 'mx-widget-loading' : 'pt-widget-loading';
  const sourceClass = isMatrix ? 'mx-widget-source' : 'pt-widget-source';

  return (
    <div className={wrapClass} ref={ref}>
      {!loaded && (
        <div className={loadingClass}>
          <Radio size={20} />
          <span>Opening the TradingView {calendar ? 'calendar' : 'news feed'}…</span>
        </div>
      )}
      {active && (
        <iframe
          title={calendar ? 'TradingView economic calendar' : 'TradingView market news'}
          srcDoc={source}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          loading="lazy"
          style={isMatrix ? { height: `${height}px` } : undefined}
          onLoad={() => setLoaded(true)}
        />
      )}
      <a className={sourceClass} href={link} target="_blank" rel="noopener noreferrer">
        {calendar ? 'Open full economic calendar' : 'Read market news'} on TradingView <ArrowUpRight size={13} />
      </a>
    </div>
  );
}
