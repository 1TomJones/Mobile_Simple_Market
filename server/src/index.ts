import path from 'node:path';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import type { Candle, LeaderboardRow, MarketState, OrderPayload, RoomJoinPayload, SymbolCode } from '@market/shared';

dotenv.config();

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const ADMIN_PIN = process.env.ADMIN_PIN ?? '1234';
const PORT = Number(process.env.PORT ?? 3000);
const DEFAULT_ROOM = 'PUBLIC';
const CANDLE_MS = 5000;

type SessionUser = {
  userId: string;
  username: string;
  roomCode: string;
};

const symbolSeeds: Record<SymbolCode, { name: string; price: number }> = {
  BTC: { name: 'Bitcoin', price: 60000 },
  ETH: { name: 'Ethereum', price: 3000 },
  SOL: { name: 'Solana', price: 120 },
  DOGE: { name: 'Dogecoin', price: 0.15 }
};

const market: Record<SymbolCode, MarketState> = (Object.keys(symbolSeeds) as SymbolCode[]).reduce((acc, symbol) => {
  const seed = symbolSeeds[symbol];
  acc[symbol] = {
    symbol,
    name: seed.name,
    price: seed.price,
    sessionOpen: seed.price,
    volatility: 0.002,
    liquidity: 12000,
    spread: 0.002,
    feeBps: 12,
    halted: false,
    supply: 1_000_000,
    trendBias: 0,
    drift: 0,
    candleHistory: []
  };
  return acc;
}, {} as Record<SymbolCode, MarketState>);

const activeCandle: Record<SymbolCode, Candle | null> = { BTC: null, ETH: null, SOL: null, DOGE: null };
const socketUsers = new Map<string, SessionUser>();
const orderRate = new Map<string, number[]>();

const normal = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

async function ensureDefaultRoom() {
  await prisma.room.upsert({
    where: { code: DEFAULT_ROOM },
    create: { code: DEFAULT_ROOM },
    update: {}
  });
}

function updateTick() {
  const now = Date.now();
  for (const symbol of Object.keys(market) as SymbolCode[]) {
    const m = market[symbol];
    const supplyPressure = (1_000_000 - m.supply) / 1_000_000 * 0.0005;
    const meanReversion = (m.sessionOpen - m.price) / m.sessionOpen * 0.0002;
    const baseMove = normal() * m.volatility;
    const liquidityScaler = Math.max(0.4, 15000 / Math.max(500, m.liquidity));
    const delta = (baseMove + m.trendBias + supplyPressure + meanReversion + m.drift) * liquidityScaler;

    m.price = Math.max(0.0001, m.price * (1 + delta));

    let candle = activeCandle[symbol];
    if (!candle || now - candle.time >= CANDLE_MS) {
      if (candle) {
        m.candleHistory.push(candle);
        if (m.candleHistory.length > 200) m.candleHistory.shift();
        io.to('room:PUBLIC').emit('candle_update', { symbol, candle });
      }
      candle = { time: Math.floor(now / CANDLE_MS) * CANDLE_MS, open: m.price, high: m.price, low: m.price, close: m.price };
      activeCandle[symbol] = candle;
    } else {
      candle.high = Math.max(candle.high, m.price);
      candle.low = Math.min(candle.low, m.price);
      candle.close = m.price;
    }
    m.trendBias *= 0.985;
    m.drift *= 0.98;
  }
  io.emit('market_update', Object.values(market).map((m) => ({
    symbol: m.symbol,
    price: m.price,
    changePct: ((m.price - m.sessionOpen) / m.sessionOpen) * 100,
    halted: m.halted,
    spread: m.spread,
    feeBps: m.feeBps,
    liquidity: m.liquidity
  })));
}

function calcFillPrice(m: MarketState, side: 'BUY' | 'SELL', qty: number) {
  const slippage = (qty / Math.max(100, m.liquidity)) * 0.02;
  const spreadCost = m.spread / 2 + slippage;
  return side === 'BUY' ? m.price * (1 + spreadCost) : m.price * (1 - spreadCost);
}

async function leaderboard(roomCode: string): Promise<LeaderboardRow[]> {
  const room = await prisma.room.findUnique({ where: { code: roomCode } });
  if (!room) return [];
  const users = await prisma.user.findMany({ where: { roomId: room.id }, include: { positions: true } });
  const rows = users.map((u) => {
    let unrealized = 0;
    for (const p of u.positions) {
      const m = market[p.symbol as SymbolCode];
      unrealized += (m.price - p.avgEntry) * p.qty;
    }
    return { userId: u.id, username: u.username, cash: u.cash, unrealized, equity: u.cash + unrealized };
  }).sort((a, b) => b.equity - a.equity);

  await prisma.leaderboardSnapshot.create({ data: { roomId: room.id, payload: JSON.stringify(rows.slice(0, 20)) } });
  return rows;
}

async function logEvent(roomCode: string, eventType: string, message: string, symbol?: SymbolCode) {
  const room = await prisma.room.findUnique({ where: { code: roomCode } });
  if (!room) return;
  const event = await prisma.eventLog.create({
    data: { roomId: room.id, eventType, message, symbol }
  });
  io.to(`room:${roomCode}`).emit('event_log', event);
}

function applyTeachingEvent(symbol: SymbolCode, eventType: string) {
  const m = market[symbol];
  if (!m) return;
  switch (eventType) {
    case 'PUMP':
      m.trendBias += 0.003;
      break;
    case 'DUMP':
      m.trendBias -= 0.003;
      break;
    case 'RUG_PULL':
      m.liquidity = Math.max(50, m.liquidity * 0.05);
      m.spread = Math.min(0.2, m.spread + 0.03);
      m.trendBias -= 0.005;
      break;
    case 'FAKE_BREAKOUT':
      m.trendBias += 0.004;
      setTimeout(() => { m.trendBias -= 0.007; }, 15000);
      break;
    case 'DILUTION':
      m.supply *= 1.4;
      m.drift -= 0.002;
      break;
    case 'WHALE_CANDLE':
      m.price *= 1 + (Math.random() > 0.5 ? 0.08 : -0.08);
      break;
    case 'FEE_HIKE':
      m.feeBps = Math.min(200, m.feeBps + 25);
      break;
    case 'SPREAD_WIDEN':
      m.spread = Math.min(0.1, m.spread + 0.01);
      break;
    case 'TRADING_HALT':
      m.halted = !m.halted;
      break;
    case 'WASH_TRADING':
      m.volatility += 0.0015;
      m.trendBias += (Math.random() > 0.5 ? 1 : -1) * 0.001;
      setTimeout(() => { m.volatility = Math.max(0.001, m.volatility - 0.0015); }, 20000);
      break;
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/admin/auth', (req, res) => {
  if (req.body?.pin === ADMIN_PIN) return res.json({ ok: true, token: ADMIN_PIN });
  return res.status(401).json({ ok: false });
});

const staticDir = path.resolve(__dirname, '../../client/dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(staticDir));
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
}

io.on('connection', (socket) => {
  socket.on('join_room', async (payload: RoomJoinPayload, cb) => {
    const roomCode = (payload.roomCode || DEFAULT_ROOM).toUpperCase();
    const username = payload.username.trim().slice(0, 20);
    if (!username) return cb({ ok: false, error: 'Username required' });

    const room = await prisma.room.upsert({ where: { code: roomCode }, create: { code: roomCode, password: payload.password }, update: {} });
    let user = await prisma.user.findUnique({ where: { roomId_username: { roomId: room.id, username } }, include: { positions: true } });
    if (!user) {
      user = await prisma.user.create({ data: { roomId: room.id, username }, include: { positions: true } });
      for (const symbol of Object.keys(market)) {
        await prisma.position.create({ data: { userId: user.id, symbol } });
      }
      user = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { positions: true } });
    }

    socket.join(`room:${roomCode}`);
    socketUsers.set(socket.id, { userId: user.id, username, roomCode });
    const board = await leaderboard(roomCode);

    cb({
      ok: true,
      user: { userId: user.id, username },
      portfolio: { cash: user.cash, positions: user.positions },
      market: Object.values(market),
      leaderboard: board.slice(0, 20)
    });
  });

  socket.on('place_order', async (payload: OrderPayload, cb) => {
    const session = socketUsers.get(socket.id);
    if (!session) return cb({ ok: false, error: 'Not joined' });

    const stamps = orderRate.get(session.userId) ?? [];
    const fresh = stamps.filter((s) => Date.now() - s < 2000);
    if (fresh.length >= 5) return cb({ ok: false, error: 'Rate limited' });
    fresh.push(Date.now());
    orderRate.set(session.userId, fresh);

    const m = market[payload.symbol];
    if (!m || m.halted) return cb({ ok: false, error: 'Trading halted' });
    if (payload.qty <= 0) return cb({ ok: false, error: 'Invalid qty' });

    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    const pos = await prisma.position.findUnique({ where: { userId_symbol: { userId: session.userId, symbol: payload.symbol } } });
    if (!user || !pos) return cb({ ok: false, error: 'Account issue' });

    const fillPrice = calcFillPrice(m, payload.side, payload.qty);
    const gross = fillPrice * payload.qty;
    const fee = gross * (m.feeBps / 10000);

    if (payload.side === 'BUY') {
      const total = gross + fee;
      if (user.cash < total) return cb({ ok: false, error: 'Insufficient cash' });
      const newQty = pos.qty + payload.qty;
      const newAvg = newQty === 0 ? 0 : ((pos.qty * pos.avgEntry) + gross) / newQty;
      await prisma.user.update({ where: { id: user.id }, data: { cash: user.cash - total } });
      await prisma.position.update({ where: { id: pos.id }, data: { qty: newQty, avgEntry: newAvg } });
    } else {
      if (pos.qty < payload.qty) return cb({ ok: false, error: 'Insufficient tokens' });
      const pnl = (fillPrice - pos.avgEntry) * payload.qty;
      await prisma.user.update({ where: { id: user.id }, data: { cash: user.cash + gross - fee, realizedPnl: user.realizedPnl + pnl } });
      await prisma.position.update({ where: { id: pos.id }, data: { qty: pos.qty - payload.qty, realizedPnl: pos.realizedPnl + pnl, avgEntry: pos.qty - payload.qty <= 0 ? 0 : pos.avgEntry } });
    }

    const room = await prisma.room.findUniqueOrThrow({ where: { code: session.roomCode } });
    await prisma.trade.create({
      data: {
        roomId: room.id,
        userId: user.id,
        symbol: payload.symbol,
        side: payload.side,
        qty: payload.qty,
        fillPrice,
        feePaid: fee
      }
    });
    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { positions: true } });
    cb({ ok: true, fillPrice, fee, portfolio: { cash: updatedUser.cash, positions: updatedUser.positions } });

    const board = await leaderboard(session.roomCode);
    io.to(`room:${session.roomCode}`).emit('leaderboard_update', board.slice(0, 20));
  });

  socket.on('admin_control', async (payload, cb) => {
    if (payload.pin !== ADMIN_PIN) return cb({ ok: false, error: 'Unauthorized' });
    const m = market[payload.symbol as SymbolCode];
    if (!m) return cb({ ok: false, error: 'Bad symbol' });
    if (typeof payload.volatility === 'number') m.volatility = Math.max(0.0002, payload.volatility);
    if (typeof payload.liquidity === 'number') m.liquidity = Math.max(50, payload.liquidity);
    if (typeof payload.spread === 'number') m.spread = Math.max(0.0005, payload.spread);
    if (typeof payload.feeBps === 'number') m.feeBps = Math.max(0, payload.feeBps);
    if (typeof payload.halted === 'boolean') m.halted = payload.halted;
    if (typeof payload.supplyDelta === 'number') m.supply = Math.max(1, m.supply + payload.supplyDelta);
    await logEvent(DEFAULT_ROOM, 'ADMIN_CONTROL', `Adjusted controls for ${payload.symbol}`, payload.symbol);
    cb({ ok: true, state: m });
  });

  socket.on('admin_event', async (payload, cb) => {
    if (payload.pin !== ADMIN_PIN) return cb({ ok: false, error: 'Unauthorized' });
    applyTeachingEvent(payload.symbol, payload.eventType);
    await logEvent(payload.roomCode || DEFAULT_ROOM, payload.eventType, `Event ${payload.eventType} on ${payload.symbol}`, payload.symbol);
    cb({ ok: true });
  });

  socket.on('admin_broadcast', async (payload, cb) => {
    if (payload.pin !== ADMIN_PIN) return cb({ ok: false, error: 'Unauthorized' });
    io.to(`room:${DEFAULT_ROOM}`).emit('broadcast_message', { message: payload.message, ts: Date.now() });
    await logEvent(DEFAULT_ROOM, 'BROADCAST', payload.message);
    cb({ ok: true });
  });

  socket.on('fetch_leaderboard', async (roomCode: string, cb) => cb(await leaderboard(roomCode || DEFAULT_ROOM)));

  socket.on('disconnect', () => {
    socketUsers.delete(socket.id);
  });
});

setInterval(updateTick, 1000);
setInterval(async () => {
  const board = await leaderboard(DEFAULT_ROOM);
  io.to(`room:${DEFAULT_ROOM}`).emit('leaderboard_update', board.slice(0, 20));
}, 10000);

ensureDefaultRoom().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server listening on ${PORT}`);
  });
});
