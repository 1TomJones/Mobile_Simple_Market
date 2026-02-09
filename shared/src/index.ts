export type SymbolCode = 'BTC' | 'ETH' | 'SOL' | 'DOGE';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface MarketState {
  symbol: SymbolCode;
  name: string;
  price: number;
  sessionOpen: number;
  volatility: number;
  liquidity: number;
  spread: number;
  feeBps: number;
  halted: boolean;
  supply: number;
  trendBias: number;
  drift: number;
  candleHistory: Candle[];
}

export interface PositionView {
  symbol: SymbolCode;
  qty: number;
  avgEntry: number;
  realizedPnl: number;
}

export interface PortfolioView {
  cash: number;
  positions: PositionView[];
}

export interface LeaderboardRow {
  userId: string;
  username: string;
  equity: number;
  cash: number;
  unrealized: number;
}

export interface RoomJoinPayload {
  username: string;
  roomCode: string;
  password?: string;
}

export interface OrderPayload {
  symbol: SymbolCode;
  side: 'BUY' | 'SELL';
  qty: number;
}

export interface AdminControlPayload {
  pin: string;
  symbol: SymbolCode;
  volatility?: number;
  liquidity?: number;
  spread?: number;
  feeBps?: number;
  halted?: boolean;
  supplyDelta?: number;
}

export interface EventTriggerPayload {
  pin: string;
  roomCode: string;
  symbol: SymbolCode;
  eventType:
    | 'PUMP'
    | 'DUMP'
    | 'RUG_PULL'
    | 'FAKE_BREAKOUT'
    | 'DILUTION'
    | 'WHALE_CANDLE'
    | 'FEE_HIKE'
    | 'SPREAD_WIDEN'
    | 'TRADING_HALT'
    | 'WASH_TRADING';
}
