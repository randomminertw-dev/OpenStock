# Four-Factor Period Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者按市場保存四因素各自的 N；加密貨幣另存 4h／8h／12h／日 K，且不改變既有 57 項投票或期間探索。

**Architecture:** 純函式負責預設、驗證及四因素計算；獨立 MongoDB 集合保存每帳號、每市場的偏好。四因素資料流與固定日 K 的投票／期間資料流分離，設定面板只重新請求四因素與 IDS-Factor。

**Tech Stack:** Next.js 15 App Router、React 19、TypeScript strict、Mongoose／MongoDB、Better Auth、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-13-four-factor-period-preferences-design.md`

## Global Constraints

- 只調整四因素 T/M/V/R 與 IDS-Factor；57 項投票、IDS-Indicator、IDS-Period、期間探索維持固定日 K 與原公式。
- 每帳號每市場僅一組：`us`、`taiwan`、`crypto`；國際市場維持 n=14，不提供設定。市場由 `candleMarket(symbol)` 判定，`userId` 只能來自 session。
- 股票預設短／中／長為 7／21／126、範圍 5–126；加密貨幣為 10／30／180、範圍 5–180。未儲存時四項 n=14；crypto 為日 K，標為「現行預設」。
- Crypto 週期只限 `4h`、`8h`、`12h`、`1d`；切換時 N 不變。R 仍使用最近最多 252 筆 ATR% 與至少 126 筆門檻，顯示實際樣本數。
- 小時 K 至少取得近期 432 根有效、已收盤 K 線並留缺口餘量；快取鍵含週期，不可靜默改用日 K。缺量則 V 為 N/A，其他因素盡可能計算。
- 手機兩欄四因素／N 輸入、三等寬預設鈕、crypto 週期 2×2、全寬動作鈕；輸入與按鈕至少 44px 高，數字輸入至少 16px。
- 不執行 `clasp push/deploy`；本計畫僅修改 Next.js 專案，任何完成宣稱都附實際測試與手動驗收證據。

## Review Focus

1. 長 N 搭配 4h 時，查詢不能因升冪 1000 根上限而返回數月前資料；Task 2 測近期最後一根完整 K 線與不足 432 根的情況。
2. 59 根資料下 57 投票仍不足，但短 N 的可算因素不能跟著消失；Task 4、5 測分流及畫面。
3. `CG:` 缺成交量、Binance／Alpaca 尚未收盤的 K 線或供應商故障，不能產生假 V／假成功／日 K 降級；Task 2、4 測。
4. 兩帳號、不同市場、偽造 market／userId 或非法 N／週期不得互相污染；Task 1、3 測伺服器推導與驗證。
5. 切換週期及未儲存預覽不應重設 N 或持久化，也不應改動 57 投票／IDS-Period；Task 5 測操作與固定區快照。

---

### Task 1: 偏好契約與四個獨立 N

**Files:**
- Create: `lib/indicators/factor-periods.ts`, `lib/indicators/factor-periods.test.ts`
- Modify: `lib/indicators/factors.ts`, `lib/indicators/factors.test.ts`

**Interfaces:**
- Produce: `FactorMarket = 'us' | 'taiwan' | 'crypto'`、`CryptoInterval = '4h' | '8h' | '12h' | '1d'`、`FactorPeriods = Record<FactorId, number>`、`FactorPreference = { market: FactorMarket; preset: 'legacy' | 'short' | 'medium' | 'long' | 'custom'; periods: FactorPeriods; interval: CryptoInterval | null }`。
- Produce: `marketForSymbol(symbol: string): FactorMarket | null`、`defaultFactorPreference(market: FactorMarket): FactorPreference`、`presetFactorPreference(market: FactorMarket, preset: 'short' | 'medium' | 'long', interval?: CryptoInterval): FactorPreference`、`parseFactorPreference(market: FactorMarket, input: unknown): FactorPreference`；最後者拒絕非整數、越界 N、股票週期及錯誤市場，並依四個 N 正規化預設／自訂標籤。
- Change: `computeFactors(candles: Candle[], periods?: number | FactorPeriods): FourFactors`，保留舊 `number` 呼叫與預設 n=14；R 的 `reason` 顯示分位樣本數，必要時新增 `FactorScore.sampleCount?: number`。

- [ ] **Step 1: Write failing tests.** 在上述測試檔斷言三市場預設與上下限、五類 symbol 的市場辨識、非法值拒絕，以及各因素 N 與舊版相容，例如 `expect(computeFactors(candles, {T:7,M:21,V:10,R:14}).M.n).toBe(21)`、`expect(computeFactors(candles).R.n).toBe(14)`、`expect(() => parseFactorPreference('crypto', { ...valid, periods: { ...valid.periods, T: 181 } })).toThrow()`。
- [ ] **Step 2: Run tests to confirm RED.** `npx vitest run lib/indicators/factor-periods.test.ts lib/indicators/factors.test.ts`；預期新匯出或各因素 N 斷言失敗。
- [ ] **Step 3: Implement interfaces.** 實作純設定函式與四個 N 分流；不要變更 T/M/V/R 公式、IDS-Factor 投票成員或 R 的 252／126 門檻。
- [ ] **Step 4: Run tests to confirm GREEN.** 同 Step 2 指令，預期全部 PASS。
- [ ] **Step 5: Commit.** `git add lib/indicators/factor-periods.ts lib/indicators/factor-periods.test.ts lib/indicators/factors.ts lib/indicators/factors.test.ts && git commit -m "feat: configure four factor periods independently"`

### Task 2: 加密貨幣近期完整週期 K 線

**Files:**
- Modify: `lib/candles/providers.ts`, `lib/actions/alpaca.actions.ts`, `lib/actions/candles-routing.test.ts`

**Interfaces:**
- Consume: `CryptoInterval` from Task 1。
- Produce: `getFactorCandlesWithReason(symbol: string, interval: CryptoInterval): Promise<CandleResult>` in `alpaca.actions.ts`；日 K 重用 `getDailyCandlesWithReason(symbol, 400)`，小時 K 僅接受 `binance`／`coingecko` 標的。
- Produce: `binanceIntervalCandles(pair: string, interval: Exclude<CryptoInterval, '1d'>): Promise<CandleResult>` in `providers.ts`；`CG:` 以 Alpaca crypto bars `4Hour`／`8Hour`／`12Hour` 讀取。

- [ ] **Step 1: Write failing tests.** `it.each(['4h','8h','12h'])` 驗證 Binance／CG 的 timeframe、最近約 550 根請求範圍、完整收盤過濾、最新時間、週期隔離的快取與並行去重；例如 `expect(url.searchParams.get('interval')).toBe('4h')`、`expect(lastBarTime).toBeLessThanOrEqual(now - 4*3600_000)`。另測少於 432 根仍回傳實際資料、缺量及 API 錯誤保留原因而不退回日 K；固定時鐘測 UTC 收盤邊界。
- [ ] **Step 2: Run tests to confirm RED.** `npx vitest run lib/actions/candles-routing.test.ts`；預期新入口及週期測試失敗。
- [ ] **Step 3: Implement interfaces.** Binance 用 `4h/8h/12h` 及 close time；Alpaca 用 `4Hour/8Hour/12Hour`、bar 開始時間加週期判定完整。從現在倒推足夠近期範圍（目標約 550 根），只取已收盤 bar；保留 `CandleSource.timeZone`，快取鍵加入週期。
- [ ] **Step 4: Run tests to confirm GREEN.** 同 Step 2 指令，預期全部 PASS。
- [ ] **Step 5: Commit.** `git add lib/candles/providers.ts lib/actions/alpaca.actions.ts lib/actions/candles-routing.test.ts && git commit -m "feat: load recent closed crypto interval candles"`

### Task 3: 帳號／市場偏好儲存

**Files:**
- Create: `database/models/factor-preference.model.ts`, `lib/actions/factor-preferences.actions.ts`, `lib/actions/factor-preferences.actions.test.ts`

**Interfaces:**
- Consume: `FactorPreference`、`marketForSymbol`、`defaultFactorPreference`、`parseFactorPreference` from Task 1。
- Produce: `getFactorPreference(symbol: string): Promise<{ preference: FactorPreference; readError: boolean } | null>`；不支援市場回 `null`，讀取失敗回退 n=14 並設 `readError: true`。
- Produce: `saveFactorPreference(symbol: string, input: unknown): Promise<FactorPreference>`；從 `requireUserId()` 與 symbol 判定帳號／市場，驗證後 upsert，以 `{ userId, market }` 建唯一索引，資料庫失敗須拋錯供 UI 顯示。

- [ ] **Step 1: Write failing tests.** Mock session／Mongoose，驗證兩帳號與三市場隔離、同市場跨標的讀取、無資料 n=14＋crypto `1d`、讀取錯誤警示、未登入、偽造 `market/userId`、小數／越界 N／非法週期、寫入失敗不回傳成功；例如 `expect(upsertFilter).toEqual({ userId: 'session-user', market: 'crypto' })`、`expect(await getFactorPreference('CG:bitcoin')).toMatchObject({ preference: { interval: '1d', periods: { T: 14 } }, readError: false })`。
- [ ] **Step 2: Run tests to confirm RED.** `npx vitest run lib/actions/factor-preferences.actions.test.ts`；預期新動作或模型測試失敗。
- [ ] **Step 3: Implement interfaces.** 沿用 `connectToDatabase`、`requireUserId` 和 watchlist 的 Mongoose 模式；不改 Better Auth `additionalFields`，也不以 session cookie 保存偏好。
- [ ] **Step 4: Run tests to confirm GREEN.** 同 Step 2 指令，預期全部 PASS。
- [ ] **Step 5: Commit.** `git add database/models/factor-preference.model.ts lib/actions/factor-preferences.actions.ts lib/actions/factor-preferences.actions.test.ts && git commit -m "feat: save factor preferences per account and market"`

### Task 4: 四因素與固定日 K 計算分流

**Files:**
- Modify: `lib/actions/indicators.actions.ts`, `__tests__/market-indicators.test.tsx`

**Interfaces:**
- Consume: `FactorPreference`／`parseFactorPreference` from Task 1、`getFactorCandlesWithReason` from Task 2。
- Produce: `getFourFactorAssessmentWithReason(symbol: string, input: unknown): Promise<{ assessment: { factors: FourFactors; idsFactor: IDSFactorResult; asof: string; source: CandleSource | null; interval: CryptoInterval | '1d' } | null; reason: AssessmentFailureReason | null; candleCount: number }>`；服務端依 symbol 驗證偏好，股票日 K，crypto 依偏好週期。
- Produce: `getPeriodAssessment(symbol: string): Promise<{ variants: Record<string, VariantResult[]>; idsPeriod: Record<string, IDSPeriodResult> } | null>`；永遠使用現行日 K 與 60 根門檻。既有 `getFactorAssessment(symbol)` 保留為 n=14 相容 wrapper，避免破壞舊呼叫者。

- [ ] **Step 1: Write failing tests.** 以 59 根日 K 驗證 `getIndicatorAssessmentWithReason` 仍回不足、`getFourFactorAssessmentWithReason` 的短 N 可算部分因素；例如 `expect(vote.reason).toBe('insufficient-data')`、`expect(factor.assessment?.factors.M.score).not.toBeNull()`。另測 crypto `4h` 只改因素／IDS-Factor、缺量 V=N/A、R 樣本不足單項 N/A、固定期間輸出與設定前一致。
- [ ] **Step 2: Run tests to confirm RED.** `npx vitest run __tests__/market-indicators.test.tsx`；預期新入口或隔離斷言失敗。
- [ ] **Step 3: Implement interfaces.** 拆出固定期間與可設定因素；只有 57 投票／固定期間沿用 60 根門檻。沿用 `toCandles`、缺量判斷與 IDS-Factor 的 T/M/V 規則；小時 K 不足時保留可計算因素及來源原因。
- [ ] **Step 4: Run tests to confirm GREEN.** 同 Step 2 指令，預期全部 PASS。
- [ ] **Step 5: Commit.** `git add lib/actions/indicators.actions.ts __tests__/market-indicators.test.tsx && git commit -m "feat: separate configurable factors from daily votes"`

### Task 5: 標的頁設定、預覽與手機版

**Files:**
- Create: `components/stocks/FactorSettings.tsx`
- Modify: `components/stocks/IndicatorDashboard.tsx`, `components/stocks/FactorCards.tsx`, `__tests__/market-indicators.test.tsx`

**Interfaces:**
- Consume: Task 3 的 `getFactorPreference`／`saveFactorPreference`，Task 4 的 `getFourFactorAssessmentWithReason`／`getPeriodAssessment`。
- `FactorSettings` 接受 `symbol`、初始偏好、初始四因素回應與 `readError`；只管理當頁草稿／預覽／儲存狀態，不擁有 57 投票與固定期間資料。

- [ ] **Step 1: Write failing tests.** 擴充 SSR 測試，例如 `expect(html).toContain('現行預設')`、`expect(html).toContain('四因素評分')`（即使投票只有 59 根）。互動驗收案例記錄在同一測試檔旁：crypto 換週期 N 不變、預覽不呼叫儲存、儲存成功跨標的讀取、失敗保留草稿；固定 57 投票與 IDS-Period 不變。手機實測 320／375px 無橫向捲動，按鈕／輸入高度與字級符合 Global Constraints。
- [ ] **Step 2: Run tests to confirm RED.** `npx vitest run __tests__/market-indicators.test.tsx`；預期設定與獨立顯示斷言失敗。
- [ ] **Step 3: Implement UI.** `IndicatorDashboard` 的投票不足狀態只影響投票區；固定期間與可設定因素各自呈現。設定面板提供三預設、四個 N、crypto 四週期、暫時套用與儲存；儲存成功才標「已儲存」，失敗留草稿；`FactorCards` 顯示 R 樣本、週期／完整 asof／時區及跨市場不可直比說明。
- [ ] **Step 4: Verify GREEN and regression.** `npx vitest run __tests__/market-indicators.test.tsx lib/indicators/factor-periods.test.ts lib/indicators/factors.test.ts lib/actions/candles-routing.test.ts lib/actions/factor-preferences.actions.test.ts`，再執行 `npx tsc --noEmit`、`npm run lint`、`npm test`；記錄既有基線失敗與本次失敗的差別，瀏覽器手動驗收 AAPL／2330.TW／BINANCE:BTCUSDT／CG:bitcoin、跨帳號及 320／375px。
- [ ] **Step 5: Commit.** `git add components/stocks/FactorSettings.tsx components/stocks/IndicatorDashboard.tsx components/stocks/FactorCards.tsx __tests__/market-indicators.test.tsx && git commit -m "feat: add market factor settings and mobile preview"`

## 完成條件

所有五項任務通過其目標測試與型別檢查；手動驗證儲存／預覽、三市場及四種 crypto 週期；任何外部供應商或既有全域測試失敗須附具體輸出，不以「已修復」代替證據。實作後若修正 bug，依專案指引將案例補入對應 bullpen skill 與 `AGENTS.md` 事件紀錄（≤10 行）；不執行部署。
