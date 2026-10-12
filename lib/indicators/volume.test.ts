import { describe, expect, it } from 'vitest';
import { computeVolume } from './volume';
import type { Candle, IndicatorResult } from './types';

/**
 * 上升／下跌趨勢夾具（與 volatility 測試同形狀）：
 * rising  → close = 300 + 2.5·i + 0.002·i²
 * falling → close = 300 − 2.5·i − 0.002·i²
 * 每根 h = c + 0.5，l = c − 0.5，v = 1000。
 */
function makeTrend(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const c =
      dir === 1 ? 300 + 2.5 * i + 0.002 * i * i : 300 - 2.5 * i - 0.002 * i * i;
    out.push({ t: i, o: c - 0.2, h: c + 0.5, l: c - 0.5, c, v: 1000 });
  }
  return out;
}

/** 完全平盤夾具（測試除零／退化保護：不得出現 NaN）。 */
function makeFlat(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1000 });
  }
  return out;
}

/**
 * 爆量夾具：19 根平盤（v = 1000）後，最後一根爆量 v = 5000。
 * dir = 1  → 收漲（o = 100, c = 101）→ 預期 +1
 * dir = -1 → 收跌（o = 100, c = 99）→ 預期 −1
 */
function makeVolumeSpike(dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v: 1000 });
  }
  const c = dir === 1 ? 101 : 99;
  out.push({ t: 19, o: 100, h: Math.max(100, c) + 0.3, l: Math.min(100, c) - 0.3, c, v: 5000 });
  return out;
}

/** 縮量夾具：19 根平盤後，最後一根 v = 300 且收漲 → 預期 0。 */
function makeVolumeQuiet(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v: 1000 });
  }
  out.push({ t: 19, o: 100, h: 101.3, l: 99.7, c: 101, v: 300 });
  return out;
}

/** 爆量但收平夾具：最後一根 v = 5000，o = c = 100 → 預期 0。 */
function makeVolumeSpikeFlatClose(): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < 19; i++) {
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v: 1000 });
  }
  out.push({ t: 19, o: 100, h: 100.3, l: 99.7, c: 100, v: 5000 });
  return out;
}

/**
 * CLV 夾具（h = 101, l = 99）：
 * dir = 1  → c = 101（收在最高）→ CLV = +1 → CMF = +1, AD 上升
 * dir = -1 → c = 99（收在最低）→ CLV = −1 → CMF = −1, AD 下降
 * dir = 0  → c = 100（收在中間）→ CLV = 0 → 中性
 */
function makeCLV(n: number, dir: 1 | -1 | 0): Candle[] {
  const out: Candle[] = [];
  const c = dir === 1 ? 101 : dir === -1 ? 99 : 100;
  for (let i = 0; i < n; i++) {
    out.push({ t: i, o: c - 0.2, h: 101, l: 99, c, v: 1000 });
  }
  return out;
}

/**
 * 成交量趨勢夾具（價格平盤，僅成交量變化）：
 * dir = 1 → v = 1000 + 100·i（遞增）；dir = -1 → v = 1000 + 100·(n−1−i)（遞減）
 */
function makeVolumeTrend(n: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const v = dir === 1 ? 1000 + 100 * i : 1000 + 100 * (n - 1 - i);
    out.push({ t: i, o: 100, h: 100.3, l: 99.7, c: 100, v });
  }
  return out;
}

function byId(results: IndicatorResult[], id: string): IndicatorResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`missing indicator ${id}`);
  return r;
}

describe('computeVolume — structure', () => {
  const results = computeVolume(makeTrend(30, 1));

  it('returns 10 indicators, all category volume', () => {
    expect(results).toHaveLength(10);
    for (const r of results) {
      expect(r.category).toBe('volume');
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('covers the 10 specified indicator ids', () => {
    const ids = results.map((r) => r.id);
    expect(ids).toEqual([
      'vol20',
      'obv20',
      'vwap',
      'mfi14',
      'cmf20',
      'ad20',
      'pvt20',
      'pvo12269',
      'emv14',
      'volumeprofile',
    ]);
  });

  it('never returns NaN or Infinity (flat-line fixture included)', () => {
    for (const fixture of [makeTrend(30, 1), makeFlat(30), makeVolumeTrend(30, 1)]) {
      for (const r of computeVolume(fixture)) {
        if (r.value !== null) expect(Number.isFinite(r.value)).toBe(true);
        if (r.signal !== null) expect([-1, 0, 1]).toContain(r.signal);
      }
    }
  });

  it('returns null for the 8 computed indicators on insufficient data', () => {
    const rs = computeVolume(makeTrend(5, 1));
    for (const id of ['vol20', 'obv20', 'mfi14', 'cmf20', 'ad20', 'pvt20', 'pvo12269', 'emv14']) {
      const r = byId(rs, id);
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason).toContain('資料不足');
    }
  });
});

describe('computeVolume — VOL（vs 20 日均量）', () => {
  it('votes +1 on volume spike + 收漲', () => {
    const r = byId(computeVolume(makeVolumeSpike(1)), 'vol20');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(100); // 量能佔比 > 100% → 量增
    expect(r.signal).toBe(1);
  });

  it('votes -1 on volume spike + 收跌', () => {
    const r = byId(computeVolume(makeVolumeSpike(-1)), 'vol20');
    expect(r.signal).toBe(-1);
  });

  it('votes 0 when volume is below the 20-day average', () => {
    expect(byId(computeVolume(makeVolumeQuiet()), 'vol20').signal).toBe(0);
  });

  it('votes 0 on volume spike but flat close', () => {
    expect(byId(computeVolume(makeVolumeSpikeFlatClose()), 'vol20').signal).toBe(0);
  });
});

describe('computeVolume — OBV（vs EMA20）', () => {
  it('votes +1 when OBV is above its EMA20（rising trend）', () => {
    const r = byId(computeVolume(makeTrend(30, 1)), 'obv20');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(0);
    expect(r.signal).toBe(1);
  });

  it('votes -1 when OBV is below its EMA20（falling trend）', () => {
    expect(byId(computeVolume(makeTrend(30, -1)), 'obv20').signal).toBe(-1);
  });

  it('votes 0 when OBV equals its EMA20（flat）', () => {
    expect(byId(computeVolume(makeFlat(30)), 'obv20').signal).toBe(0);
  });
});

describe('computeVolume — VWAP（N/A）', () => {
  it('always returns null value/signal with a Chinese N/A reason', () => {
    for (const fixture of [makeTrend(30, 1), makeFlat(30), makeTrend(5, 1)]) {
      const r = byId(computeVolume(fixture), 'vwap');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason).toContain('N/A');
      expect(r.reason).toContain('盤中');
    }
  });
});

describe('computeVolume — MFI（14）', () => {
  it('votes -1 when MFI > 80（rising trend, all positive money flow）', () => {
    const r = byId(computeVolume(makeTrend(30, 1)), 'mfi14');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(80);
    expect(r.signal).toBe(-1);
  });

  it('votes +1 when MFI < 20（falling trend, all negative money flow）', () => {
    const r = byId(computeVolume(makeTrend(30, -1)), 'mfi14');
    expect(r.value as number).toBeLessThan(20);
    expect(r.signal).toBe(1);
  });

  it('votes 0 on flat prices（degenerate MFI = 50）', () => {
    const r = byId(computeVolume(makeFlat(30)), 'mfi14');
    expect(r.signal).toBe(0);
  });
});

describe('computeVolume — CMF（20）', () => {
  it('votes +1 when CMF > 0（close at high）', () => {
    const r = byId(computeVolume(makeCLV(20, 1)), 'cmf20');
    expect(r.value as number).toBeCloseTo(1, 10);
    expect(r.signal).toBe(1);
  });

  it('votes -1 when CMF < 0（close at low）', () => {
    const r = byId(computeVolume(makeCLV(20, -1)), 'cmf20');
    expect(r.value as number).toBeCloseTo(-1, 10);
    expect(r.signal).toBe(-1);
  });

  it('votes 0 when CMF = 0（close mid-range）', () => {
    expect(byId(computeVolume(makeCLV(20, 0)), 'cmf20').signal).toBe(0);
  });
});

describe('computeVolume — AD（vs EMA20）', () => {
  it('votes +1 when AD is above its EMA20（accumulation）', () => {
    expect(byId(computeVolume(makeCLV(30, 1)), 'ad20').signal).toBe(1);
  });

  it('votes -1 when AD is below its EMA20（distribution）', () => {
    expect(byId(computeVolume(makeCLV(30, -1)), 'ad20').signal).toBe(-1);
  });

  it('votes 0 when AD is flat（CLV = 0）', () => {
    expect(byId(computeVolume(makeCLV(30, 0)), 'ad20').signal).toBe(0);
  });
});

describe('computeVolume — PVT（vs EMA20）', () => {
  it('votes +1 when PVT is above its EMA20（rising trend）', () => {
    expect(byId(computeVolume(makeTrend(30, 1)), 'pvt20').signal).toBe(1);
  });

  it('votes -1 when PVT is below its EMA20（falling trend）', () => {
    expect(byId(computeVolume(makeTrend(30, -1)), 'pvt20').signal).toBe(-1);
  });
});

describe('computeVolume — PVO（12,26,9）', () => {
  it('votes +1 when PVO > 0（rising volume）', () => {
    const r = byId(computeVolume(makeVolumeTrend(30, 1)), 'pvo12269');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(0);
    expect(r.signal).toBe(1);
  });

  it('votes -1 when PVO < 0（falling volume）', () => {
    const r = byId(computeVolume(makeVolumeTrend(30, -1)), 'pvo12269');
    expect(r.value as number).toBeLessThan(0);
    expect(r.signal).toBe(-1);
  });

  it('votes 0 when PVO = 0（flat volume）', () => {
    expect(byId(computeVolume(makeTrend(30, 1)), 'pvo12269').signal).toBe(0);
  });
});

describe('computeVolume — EMV（14）', () => {
  it('votes +1 when EMV > 0（rising trend）', () => {
    const r = byId(computeVolume(makeTrend(30, 1)), 'emv14');
    expect(r.value).not.toBeNull();
    expect(r.value as number).toBeGreaterThan(0);
    expect(r.signal).toBe(1);
  });

  it('votes -1 when EMV < 0（falling trend）', () => {
    const r = byId(computeVolume(makeTrend(30, -1)), 'emv14');
    expect(r.value as number).toBeLessThan(0);
    expect(r.signal).toBe(-1);
  });

  it('votes 0 when EMV = 0（flat, no movement）', () => {
    expect(byId(computeVolume(makeFlat(30)), 'emv14').signal).toBe(0);
  });
});

describe('computeVolume — VolumeProfile（N/A）', () => {
  it('always returns null value/signal with a Chinese N/A reason', () => {
    for (const fixture of [makeTrend(30, 1), makeFlat(30), makeTrend(5, 1)]) {
      const r = byId(computeVolume(fixture), 'volumeprofile');
      expect(r.value).toBeNull();
      expect(r.signal).toBeNull();
      expect(r.reason).toContain('N/A');
      expect(r.reason).toContain('價量分布');
    }
  });
});
