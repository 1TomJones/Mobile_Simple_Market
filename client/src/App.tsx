import { useEffect, useMemo, useState } from 'react';
import type { Candle, LeaderboardRow, MarketState, PositionView, SymbolCode } from '@market/shared';
import { socket } from './lib/socket';
import { CandleChart } from './components/CandleChart';

type Tab = 'TRADE' | 'PORTFOLIO' | 'LEADERBOARD' | 'ADMIN';

export function App() {
  const [joined, setJoined] = useState(false);
  const [username, setUsername] = useState('');
  const [roomCode, setRoomCode] = useState('PUBLIC');
  const [cash, setCash] = useState(0);
  const [positions, setPositions] = useState<PositionView[]>([]);
  const [market, setMarket] = useState<MarketState[]>([]);
  const [selected, setSelected] = useState<SymbolCode>('BTC');
  const [candles, setCandles] = useState<Record<string, Candle[]>>({});
  const [latestCandle, setLatestCandle] = useState<Record<string, Candle | undefined>>({});
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [qty, setQty] = useState('1');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState<Tab>('TRADE');
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [adminMessage, setAdminMessage] = useState('');
  const [eventLog, setEventLog] = useState<string[]>([]);

  const selectedMarket = market.find((m) => m.symbol === selected);
  const selectedPositions = positions.find((p) => p.symbol === selected);
  const estPrice = useMemo(() => {
    if (!selectedMarket) return 0;
    const quantity = Number(qty) || 0;
    const slip = (quantity / Math.max(100, selectedMarket.liquidity)) * 0.02;
    const spread = selectedMarket.spread / 2 + slip;
    return selectedMarket.price * (side === 'BUY' ? (1 + spread) : (1 - spread));
  }, [selectedMarket, qty, side]);

  useEffect(() => {
    socket.connect();
    socket.on('market_update', (items: Array<{symbol: SymbolCode; price: number; spread: number; feeBps: number; liquidity: number; halted: boolean;}>) => {
      setMarket((prev) => prev.map((p) => {
        const n = items.find((x) => x.symbol === p.symbol);
        return n ? { ...p, price: n.price, spread: n.spread, feeBps: n.feeBps, liquidity: n.liquidity, halted: n.halted } : p;
      }));
    });
    socket.on('candle_update', ({ symbol, candle }: {symbol: SymbolCode; candle: Candle}) => {
      setCandles((prev) => ({ ...prev, [symbol]: [...(prev[symbol] ?? []), candle].slice(-200) }));
      setLatestCandle((prev) => ({ ...prev, [symbol]: undefined }));
    });
    socket.on('leaderboard_update', setBoard);
    socket.on('event_log', (e: {createdAt: string; message: string}) => setEventLog((prev) => [`${new Date(e.createdAt).toLocaleTimeString()} ${e.message}`, ...prev].slice(0, 50)));
    socket.on('broadcast_message', (m: {message: string}) => setToast(`Broadcast: ${m.message}`));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => toast && setToast(''), 2800);
    return () => clearTimeout(t);
  }, [toast]);

  const joinRoom = () => {
    socket.emit('join_room', { username, roomCode }, (res: {ok: boolean; error?: string; portfolio?: {cash: number; positions: PositionView[]}; market?: MarketState[]; leaderboard?: LeaderboardRow[]; user?: {userId: string; username: string}}) => {
      if (!res.ok) return setToast(res.error);
      setJoined(true);
      if (!res.portfolio || !res.market || !res.leaderboard) return setToast('Malformed join payload');
      setCash(res.portfolio.cash);
      setPositions(res.portfolio.positions);
      setMarket(res.market);
      setBoard(res.leaderboard);
      const next: Record<string, Candle[]> = {};
      for (const m of res.market) next[m.symbol] = m.candleHistory;
      setCandles(next);
      setToast('Joined room');
    });
  };

  const placeOrder = () => {
    socket.emit('place_order', { symbol: selected, side, qty: Number(qty) }, (res: {ok: boolean; error?: string; fillPrice?: number; fee?: number; portfolio?: {cash: number; positions: PositionView[]}}) => {
      if (!res.ok) return setToast(res.error);
      if (!res.portfolio || res.fillPrice === undefined || res.fee === undefined) return setToast('Malformed order payload');
      setCash(res.portfolio.cash);
      setPositions(res.portfolio.positions);
      setToast(`Fill @ ${res.fillPrice.toFixed(4)} (fee ${res.fee.toFixed(2)})`);
    });
  };

  const adminLogin = async () => {
    const r = await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: adminPinInput }) });
    if (!r.ok) return setToast('Bad PIN');
    const data = await r.json();
    setAdminPin(data.token);
    setToast('Admin unlocked');
  };

  const updateControl = (changes: Record<string, unknown>) => {
    socket.emit('admin_control', { pin: adminPin, symbol: selected, ...changes }, (res: {ok: boolean; error?: string}) => setToast(res.ok ? 'Control updated' : (res.error ?? 'Failed')));
  };

  const triggerEvent = (eventType: string) => {
    socket.emit('admin_event', { pin: adminPin, roomCode, symbol: selected, eventType }, (res: {ok: boolean; error?: string}) => setToast(res.ok ? `Event: ${eventType}` : (res.error ?? 'Failed')));
  };

  const broadcast = () => {
    socket.emit('admin_broadcast', { pin: adminPin, message: adminMessage }, (res: {ok: boolean; error?: string}) => {
      setToast(res.ok ? 'Broadcast sent' : res.error);
      if (res.ok) setAdminMessage('');
    });
  };

  if (!joined) {
    return <main className="app"><h1>Join Room</h1><input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} /><input placeholder="Room code" value={roomCode} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} /><button onClick={joinRoom}>Join</button>{toast && <div className="toast">{toast}</div>}</main>;
  }

  return (
    <main className="app">
      <header>
        <h2>{selectedMarket?.name}</h2>
        <p className="price">${selectedMarket?.price.toFixed(4)}</p>
        <p className={(selectedMarket?.price ?? 0) >= (selectedMarket?.sessionOpen ?? 0) ? 'up' : 'down'}>{(((selectedMarket?.price ?? 0) - (selectedMarket?.sessionOpen ?? 0)) / (selectedMarket?.sessionOpen ?? 1) * 100).toFixed(2)}%</p>
      </header>

      {tab === 'TRADE' && <section>
        <CandleChart candles={candles[selected] ?? []} latest={latestCandle[selected]} />
        <div className="chips">{market.map((m) => <button key={m.symbol} className={selected === m.symbol ? 'active' : ''} onClick={() => setSelected(m.symbol)}>{m.symbol}</button>)}</div>
        <div className="card">
          <div className="row"><button className={side === 'BUY' ? 'active' : ''} onClick={() => setSide('BUY')}>Buy</button><button className={side === 'SELL' ? 'active' : ''} onClick={() => setSide('SELL')}>Sell</button></div>
          <input type="number" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
          <p>Estimated fill: ${estPrice.toFixed(4)}</p>
          <button onClick={placeOrder}>Place Order</button>
        </div>
      </section>}

      {tab === 'PORTFOLIO' && <section className="card">
        <h3>Cash: ${cash.toFixed(2)}</h3>
        {positions.map((p) => {
          const px = market.find((m) => m.symbol === p.symbol)?.price ?? 0;
          const unreal = (px - p.avgEntry) * p.qty;
          return <div className="line" key={p.symbol}><b>{p.symbol}</b><span>Qty {p.qty.toFixed(4)}</span><span>Avg {p.avgEntry.toFixed(4)}</span><span>uPnL {unreal.toFixed(2)}</span><span>rPnL {p.realizedPnl.toFixed(2)}</span></div>;
        })}
      </section>}

      {tab === 'LEADERBOARD' && <section className="card">
        {board.slice(0, 20).map((r: LeaderboardRow, i: number) => <div className="line" key={r.userId}><span>#{i + 1} {r.username}</span><span>${r.equity.toFixed(2)}</span></div>)}
      </section>}

      {tab === 'ADMIN' && <section className="card">
        {!adminPin ? <><input placeholder="Admin PIN" value={adminPinInput} onChange={(e) => setAdminPinInput(e.target.value)} /><button onClick={adminLogin}>Unlock Admin</button></> : <>
          <h3>Market Controls ({selected})</h3>
          <button onClick={() => updateControl({ volatility: Number(prompt('Volatility e.g. 0.002', '0.002')) })}>Set Volatility</button>
          <button onClick={() => updateControl({ liquidity: Number(prompt('Liquidity', '12000')) })}>Set Liquidity</button>
          <button onClick={() => updateControl({ spread: Number(prompt('Spread e.g. 0.002', '0.002')) })}>Set Spread</button>
          <button onClick={() => updateControl({ feeBps: Number(prompt('Fee bps', '12')) })}>Set Fee</button>
          <button onClick={() => updateControl({ halted: !(selectedMarket?.halted) })}>Toggle Halt</button>
          <button onClick={() => updateControl({ supplyDelta: Number(prompt('Supply delta (+/-)', '10000')) })}>Mint/Burn Supply</button>
          <h3>Teaching Events</h3>
          <div className="chips">{['PUMP','DUMP','RUG_PULL','FAKE_BREAKOUT','DILUTION','WHALE_CANDLE','FEE_HIKE','SPREAD_WIDEN','TRADING_HALT','WASH_TRADING'].map((e) => <button key={e} onClick={() => triggerEvent(e)}>{e}</button>)}</div>
          <textarea placeholder="Broadcast message" value={adminMessage} onChange={(e) => setAdminMessage(e.target.value)} />
          <button onClick={broadcast}>Broadcast</button>
          <div>{eventLog.map((e: string, i: number) => <p key={i}>{e}</p>)}</div>
        </>}
      </section>}

      <nav>{(['TRADE', 'PORTFOLIO', 'LEADERBOARD', 'ADMIN'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</nav>
      {toast && <div className="toast">{toast}</div>}
      <footer>{selectedPositions && <small>{selected} position: {selectedPositions.qty.toFixed(4)} @ {selectedPositions.avgEntry.toFixed(4)}</small>}</footer>
    </main>
  );
}
