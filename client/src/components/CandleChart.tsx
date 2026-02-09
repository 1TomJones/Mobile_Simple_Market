import { useEffect, useRef } from 'react';
import { createChart, type ISeriesApi, type CandlestickData } from 'lightweight-charts';
import type { Candle } from '@market/shared';

export function CandleChart({ candles, latest }: { candles: Candle[]; latest?: Candle }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      layout: { background: { color: '#0f172a' }, textColor: '#d1d5db' },
      width: ref.current.clientWidth,
      height: 280,
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } }
    });
    const series = chart.addCandlestickSeries();
    seriesRef.current = series;
    const resize = () => chart.applyOptions({ width: ref.current?.clientWidth ?? 320 });
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.time / 1000) as CandlestickData['time'],
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));
    if (latest) {
      data.push({ time: Math.floor(latest.time / 1000) as CandlestickData['time'], open: latest.open, high: latest.high, low: latest.low, close: latest.close });
    }
    seriesRef.current.setData(data);
  }, [candles, latest]);

  return <div ref={ref} className="chart" />;
}
