# 台股官方資料遷移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用零新增費用的官方來源補齊上市、上櫃股票及 ETF 搜尋、收盤、日 K 與分析，保留現有盤中元件。

**Architecture:** 官方 adapter 正規化公開資料，由受預算限制的同步模組寫入既有 MongoDB；頁面與指標共用持久資料，不直接重抓全市場。上市歷史按月取得，上櫃歷史按日批次共用以維持精確成交股數與交易範圍。現有 TradingView 報價獨立呈現；免費背景額度不足時使用同一模組的本機 CLI。

**Tech Stack:** Node.js 20+、Next.js 15 App Router、React 19、TypeScript strict、Mongoose、Inngest、Vitest；圖表使用原生 SVG，不增加套件或服務。

**Spec:** `docs/superpowers/specs/2026-10-13-taiwan-official-data-design.md`（使用者已核准）。

## Global Constraints

- 盤後與歷史資料使用官方來源，盤中沿用目前已存在的 API／服務；不產生任何新增費用。
- 不申請付費行情、付費排程或付費資料庫方案；新增同步預設關閉，額度與防超支設定確認完成才啟用。
- 一般指標保留現有 400 日曆天，四因素保留現有 800 日曆天；未調整價、成交股數、Asia/Taipei、既有計算公式維持一致。
- 台股不與 SPY 尾端錯位比較；新上市／資料不足保留 N/A，不填假 K 線。
- 盤中當日資料不能寫成已完成日 K；來源日期、取得時間與同步狀態分開。
- 既有 `.TW`、`.TWO`、`TWSE:`、`TPEX:` 連結相容，代號保持字串。
- 不新增台股提醒、付費盤中服務、盤中分 K、權證分析、興櫃分析或市場首頁；不擷取 TradingView iframe 數字。
- 不主動部署、對外推送、執行真實資料遷移或寄信。測試 mock 資料庫與外部來源；正式同步由使用者按 README 啟用。

## Review Focus

1. ETF 前導零、英文字母與外幣交易：主檔分類與幣別必須有官方證據；無證據維持 unknown／null（Task 2）。
2. 上櫃歷史與最新交易範圍不同：不得把月成交張數乘 1,000 接入精確股數序列（Task 1）。
3. 多 instance／多使用者觸發相同歷史工作：唯一鍵、lease、預算原子扣除避免重抓／超量（Task 3、4）。
4. 一個來源晚發布、休市或資料更正：不倒退已確認快照，不用取回時間假裝今天完成（Task 4、5）。
5. 股票搜尋較早請求後返回：不能覆寫較新中文／ETF 查詢結果，注音選字不導航（Task 5）。

## 文件與模組配置

| 路徑 | 責任 |
|---|---|
| `lib/taiwan/types.ts`、`parsers.ts`、`symbols.ts` | 可序列化 DTO、純正規化、市場／別名 |
| `lib/taiwan/sources.ts`、`datasets.ts` | 固定官方接口、查詢參數與資料集目錄 |
| `lib/taiwan/catalog.ts`、`fundamentals.ts` | 合併商品與產業／ETF 資訊映射 |
| `database/models/taiwan-{security,bar,dataset,sync,usage}.model.ts` | 商品、日 K、摘要、工作狀態與每日預算 |
| `lib/taiwan/repository.ts`、`budget.ts` | 持久讀寫與原子工作／資源限制 |
| `lib/taiwan/sync.ts`、`history.ts`、`reads.ts` | 同步、歷史排程與資料讀取 |
| `lib/actions/taiwan.actions.ts`、`lib/inngest/taiwan.ts` | 已登入使用者入口與有限背景工作 |
| `scripts/sync-taiwan.mjs`、`scripts/build-taiwan-sync.mjs` | 手動工具與以現有 TypeScript 編譯器產生可執行檔 |
| `components/stocks/Taiwan{Header,Chart,Details,HistoryStatus}.tsx` | 官方收盤、日 K 圖表、分商品資訊與回填狀態 |
| 既有搜尋、股票頁、自選與 candle routing | 連接台股資料，延續其他市場契約 |

依序執行以下任務；它們共享商品、日 K 與同步契約，使用同一計畫可避免多份計畫接口漂移。每一任務先紅燈、實作、綠燈，再作聚焦本機 commit。

## 共同型別與接口

在 Task 1 建立以下契約，後續任務使用同名型別，不各自定義近似版本：

```ts
type TaiwanExchange = 'TWSE' | 'TPEX';
type TaiwanKey = { exchange: TaiwanExchange; code: string };
type TaiwanSecurity = TaiwanKey & {
  symbol: string; name: string; kind: 'stock' | 'etf' | 'unknown';
  currency: string | null; listingDate: string | null;
  status: 'active' | 'suspended' | 'delisted' | 'unknown';
  metadata: Record<string, string>; source: string; asof: string;
};
type TaiwanBar = TaiwanKey & {
  tradingDate: string; t: number; o: number; h: number; l: number; c: number;
  v: number; change: number | null; complete: boolean;
  source: 'twse' | 'tpex'; priceBasis: 'unadjusted'; fetchedAt: string;
};
type TaiwanQuote = TaiwanKey & {
  price: number | null; change: number | null; changePercent: number | null;
  currency: string | null; tradingDate: string | null;
  source: 'twse' | 'tpex'; mode: 'close'; stale: boolean;
};
type TaiwanHistoryStatus = {
  state: 'disabled' | 'queued' | 'running' | 'partial' | 'ready' | 'error';
  completed: number; total: number; candleCount: number;
  reason: 'api-error' | 'budget-limit' | 'missing-config' | null;
};
type TaiwanHistory = { bars: TaiwanBar[]; status: TaiwanHistoryStatus };
type TaiwanEvent = { date: string; kind: 'dividend' | 'split' | 'capital-change'; title: string; source: string };
type TaiwanDetails = {
  security: TaiwanSecurity; fields: { label: string; value: string | null; period: string | null; unit: string | null }[];
  announcements: { date: string; title: string; body: string; sourceUrl: string }[];
  events: TaiwanEvent[]; asof: string | null;
};
```

所有日期 DTO 為西元字串，交易日 `YYYY-MM-DD`，取得時間 ISO。Mongoose Date 僅留在資料層，回傳前序列化。交易所為 TWSE／TPEX，provider label 為 twse／tpex，不混用名稱。

### Task 1：驗證官方來源與日 K 正規化

**Files:** Create `lib/taiwan/{types,parsers,symbols,sources,datasets}.ts`；Test `lib/taiwan/sources.test.ts`、`lib/taiwan/parsers.test.ts`；Create `__tests__/fixtures/taiwan/*.json`（最小公開測試樣本）。

**Interfaces:** Produces `parseTaiwanKey(value: string): TaiwanKey | null`（只解析帶市場的代號）、`taiwanAliases(key: TaiwanKey): string[]`、`parseTaiwanDate(value: string): string | null`、`parseTaiwanNumber(value: unknown): number | null`、`fetchTaiwanHistory(key: TaiwanKey, period: string, request: TaiwanRequester): Promise<TaiwanBar[]>`（TWSE 返回該商品，TPEX 返回該日全市場列，Task 4 統一篩選追蹤商品）。`period` 為 TWSE 的 `YYYY-MM` 或 TPEX 的 `YYYY-MM-DD`。`TaiwanRequester = (url: string, init?: RequestInit) => Promise<unknown>`，同步透過 Task 3 的受限 request 注入，來源不自行重試。

- [x] **1. 紅燈測試：** `parseTaiwanDate('115/09/01') === '2026-09-01'`；非法日期為 null；`parseTaiwanNumber('20,826,466') === 20826466`、空值為 null、字串 `0` 為 0；別名保留 `00400A`。TWSE fixture 0050 為 `stat: OK`、fields 帶額外註記欄；TPEX fixture `stat: ok`、tables 內 `成交股數` 為 13,645,310，assert volume 不為 12,770,000。
- [x] **2. 執行：** `npx vitest run lib/taiwan/parsers.test.ts lib/taiwan/sources.test.ts`；預期新模組未定義而失敗。
- [x] **3. 實作來源：** TWSE `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=YYYYMM01&stockNo=code`；TPEX `https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date=YYYY/MM/DD&response=json`。TPEX 回傳全日行情，此接口回傳所有列供 Task 4 按當次追蹤集合篩選，不能每檔重抓。不得使用 `tradingStock` 月份張數當正式 volume。欄位名映射、OHLC 一致性、零成交、malformed、回應日期／代號不符須區分錯誤；另建立最新行情及原始 dataset loaders `fetchTaiwanDataset(id: TaiwanDatasetId, request: TaiwanRequester): Promise<unknown>`。
- [x] **4. 綠燈測試：** 同 Step 2；增加 HTTP 403／429、HTML 200、有效空資料、混合無效列及跨月日期 fixture，全部 PASS。HTTP／格式錯誤不得記為歷史已完成。
- [x] **5. Commit：** `feat: add official Taiwan market adapters`，只納入本任務檔案。不再次下載整批歷史來代替 mock 測試。

### Task 2：完整商品索引、ETF 與官方資訊

**Files:** Create `lib/taiwan/catalog.ts`、`fundamentals.ts`；Extend `datasets.ts`；Test `catalog.test.ts`、`fundamentals.test.ts`。

**Interfaces:** Consumes Task 1 types／loaders。Produces `buildTaiwanCatalog(input: TaiwanCatalogInput): TaiwanSecurity[]`、`searchTaiwanCatalog(items: TaiwanSecurity[], query: string, limit = 15): TaiwanSecurity[]`、`buildTaiwanDetails(security: TaiwanSecurity, datasets: TaiwanDatasetBundle): TaiwanDetails`。在 `types.ts` 定義 `TaiwanDatasetId` 由 `datasets.ts` 的 const registry keys 推導，`TaiwanDatasetBundle = Partial<Record<TaiwanDatasetId, unknown>>`、`TaiwanCatalogInput` 為該 bundle。

- [x] **1. 紅燈測試：** 公司名單沒有 0050，但基金清單有時仍被找到；`00679B` 為 TPEX etf；中文、代號、前綴、後綴結果一致；無行情的已知商品保留；未知類型不分類為 stock；外幣來源無幣別時 currency null；一般 TWD 判定亦須保留官方交易幣別的證據，不能以基金持有海外資產推定交易幣別；ETF details 沒有公司 PE／EPS。財務空 PE 不為 0，季度累計不當單季。
- [x] **2. 執行：** `npx vitest run lib/taiwan/catalog.test.ts lib/taiwan/fundamentals.test.ts`；預期 FAIL。
- [x] **3. 實作：** TWSE 公司／基金 `opendata/t187ap03_L`、`t187ap47_L`；TPEx 公司 `/openapi/v1/mopsfin_t187ap03_O`、ETF `POST https://info.tpex.org.tw/api/etfFilter` 的 `data` 列。基本主檔＋基金主檔作分類權威，行情補名稱與可用資料；不能憑代號或最近行情宣告下市。財務 dataset 使用 TWSE `BWIBBU_ALL`、`t187ap05_L`、`t187ap14_L`、`t187ap04_L` 及各產業 `t187ap06_L_*`／`t187ap07_L_*`，TPEx 對應 `tpex_mainboard_peratio_analysis`、`mopsfin_t187ap05_O`、`mopsfin_t187ap14_O`、`mopsfin_t187ap04_O` 與 `mopsfin_t187ap0{6,7}_O_*`。adapter 啟用前對照 Swagger 定義確認每個產業存在的路徑，fixture 記錄實際 schema，未提供的欄位 null。事件來源為 TWSE `TWT48U_ALL`、TPEx `tpex_exright_prepost`；不足以確認 split 時顯示未調整價提醒，不推算分割。
- [x] **4. 綠燈：** Step 2 全 PASS；外部網址只允許 HTTPS 與可信官方／發行人網址，公告內容當純文字渲染；ETF 可顯示發行人／上市日／指數等已取資料，無資料維持缺值。
- [x] **5. Commit：** `feat: index Taiwan stocks and ETFs with official details`。

### Task 3：持久資料庫、工作 lease 與零費用預算

**Files:** Create `database/models/taiwan-{security,bar,dataset,sync,usage}.model.ts`；Create `lib/taiwan/{repository,budget,config}.ts`；Test `repository.test.ts`、`budget.test.ts`。

**Interfaces:** Produces `TaiwanRepository` interface（同步與讀取均注入同一 interface），方法 `readCatalog(): Promise<TaiwanSecurity[]>`、`readBars(key, from, through): Promise<TaiwanBar[]>`、`readDetails(key): Promise<TaiwanDetails | null>`、`writeCatalog(items): Promise<void>`、`writeBars(bars): Promise<void>`、`writeDetails(details): Promise<void>`、`claimJob(jobKey, owner, ttlMs): Promise<boolean>`、`releaseJob(jobKey, owner): Promise<void>`、`readHistoryStatus(key): Promise<TaiwanHistoryStatus>`、`writeHistoryStatus(key, status): Promise<void>`、`readDatasetCheckpoint(id): Promise<string | null>`、`writeDatasetCheckpoint(id, asof): Promise<void>`。`key: TaiwanKey`、日期 string。Produces `loadTaiwanSyncConfig(env: NodeJS.ProcessEnv): TaiwanSyncConfig | null`、`createBudgetedRequest(repo, config): TaiwanRequester`；interface 增加原子 `reserveUsage(day, amounts, limits)`、`settleUsage(day, amounts)`，amounts／limits 的 requests、jobs、transferBytes、storageBytes 均整數。

- [x] **1. 紅燈測試：** 同商品同日重寫只有一筆且可更正；雙 instance 僅一個 claim；非 owner 不能 release；過期可重取。預算缺設定／0／負數／NaN 時關閉；並行扣量不超限；被拒絕 request 不呼叫 fetch。全額預留 response 上限後以實收結算，不超限後才發現。
- [x] **2. 執行：** `npx vitest run lib/taiwan/repository.test.ts lib/taiwan/budget.test.ts`；預期 FAIL；mock Mongoose，不連正式 DB。
- [x] **3. 實作：** 唯一索引 security(exchange,code)、bar(exchange,code,tradingDate,priceBasis)、dataset(id,key,period)、job(jobKey)、usage(day)；原子條件更新／unique contention 處理。budgets 使用 Taipei 日界，schema／索引建立耗用含部署說明，DB 未設定時回報 missing-config。env 旗標 `TAIWAN_AUTO_SYNC_ENABLED`、`TAIWAN_HISTORY_ENABLED` 預設 false；`TAIWAN_MAX_REQUESTS_PER_DAY`、`TAIWAN_MAX_JOBS_PER_DAY`、`TAIWAN_MAX_TRANSFER_BYTES_PER_DAY`、`TAIWAN_MAX_STORAGE_BYTES`、`TAIWAN_MAX_TRACKED_SECURITIES`、`TAIWAN_MAX_RESPONSE_BYTES` 必須明確正整數。資料集約 4.86 MB，response 上限太小時拒絕啟用該 dataset。串流限制實收 bytes，10 秒 timeout，單一上游併發 1、至少 2 秒間距為保守預設；429／5xx 重試最多兩次且每次再次預留預算。所有 request 必須經受限 requester；不記錄憑證或完整原始財報。
- [x] **4. 綠燈：** Step 2 PASS；壓縮與無 Content-Length 回應仍限制解碼後大小；memory fixture 模擬 race／lease expiry。保留原 bar 完成日期與 fetchedAt，來自較早交易日的資料不得覆寫較新收盤。
- [x] **5. Commit：** `feat: persist Taiwan data with bounded sync budgets`。

### Task 4：盤後同步、歷史工作與手動 CLI

**Files:** Create `lib/taiwan/{sync,history}.ts`、`lib/inngest/taiwan.ts`、`scripts/{sync-taiwan,build-taiwan-sync}.mjs`、`scripts/taiwan-sync-entry.ts`；Modify `app/api/inngest/route.ts`、`package.json`；Test `sync.test.ts`、`history.test.ts`、`__tests__/taiwan-sync-cli.test.ts`。

**Interfaces:** Consumes Tasks 1–3。Produces `syncTaiwanClose(input: { repo: TaiwanRepository; request: TaiwanRequester; now: Date }): Promise<SyncSummary>`、`planTaiwanHistory(key, days, now): HistoryUnit[]`、`syncTaiwanHistory(input: { repo; request; keys: TaiwanKey[]; days: number; now: Date }): Promise<SyncSummary>`、`requestTaiwanHistory(key: TaiwanKey, days: number): Promise<TaiwanHistoryStatus>`（去重與 Inngest dispatch；無服務則 disabled）。`HistoryUnit = { exchange; period; keys: TaiwanKey[] }`、`SyncSummary = { requested: number; written: number; skipped: number; failures: string[] }` 定義於 types。參數 1–1000 日，預設回填 800。

- [x] **1. 紅燈測試：** 不同 TPEX 商品同一天只一次 request；TWSE 月工作去重；由近至遠；400／800 切片；failed 月／日不標完成。資料日期舊於今日仍顯示舊日期，當日僅有 OpenAPI 快照不能完成；历史確認後才提升完成狀態。API 失敗保留成功資料；預算不足回傳 partial／budget-limit；停牌／週末有效 no-data 不捏造 bar；每日財務資料集成功後不重複全量抓。
- [x] **2. 執行：** `npx vitest run lib/taiwan/sync.test.ts lib/taiwan/history.test.ts __tests__/taiwan-sync-cli.test.ts`；預期 FAIL。
- [x] **3. 實作：** 工作 lease 與預算、唯一 upsert、有限 retry。TWSE `holidaySchedule/holidaySchedule` 與 TPEx 官方開休市表用於判定最近應完成交易日；來源未取得時 freshness 保守標示待確認，不以週一至週五直接斷定交易日。TPEX 每日頁只保存此次追蹤集合的 canonical OHLCV，日期下載供所有追蹤商品共用；月頁不當 cache 正式日 K。近 5 個有效交易日有預算時重抓以處理更正，歷史 retention 1000 日上限，追蹤商品數依配額。同步窗口 `TZ=Asia/Taipei 30 14 * * 1-5`、`TZ=Asia/Taipei 0 18 * * 1-5`，依現有 Inngest cron 語法當次官方文件確認；旗標 false 不註冊。公告／財務在剩餘預算允許時更新，某一資料集失敗不阻止其他已成功結果。當日完整性以官方歷史回應＋收盤後時段及後續複核確認，不用時鐘單獨推定。
- [x] **4. CLI 實作與驗證：** `npm run taiwan:sync -- --dry-run --symbols TWSE:2330,TWSE:0050,TPEX:6488,TPEX:00679B --days 800`；dry-run 只列 URL／任務數與目標環境標籤，不讀寫 DB／上游；執行模式需 `--apply --target <label>` 與明確 budget，缺任一參數退出非 0。編譯 entry 至被忽略 `.taiwan-sync/`，使用既有 typescript（CLI 依賴不可含 server-only／Next alias），支持僅 close/catalog/details 或有範圍的 history。不執行實際 --apply；Step 2 全 PASS。
- [x] **5. Commit：** `feat: synchronize official Taiwan data within free quotas`。

### Task 5：官方搜尋、自選收盤與別名相容

**Files:** Create `lib/taiwan/reads.ts`、`lib/actions/taiwan.actions.ts`；Modify `lib/actions/{finnhub,watchlist}.actions.ts`、`components/SearchCommand.tsx`、`components/watchlist/WatchlistTable.tsx`；Test `lib/actions/taiwan-search.test.ts`、`taiwan-watchlist.test.ts`、`__tests__/taiwan-search-ui.test.tsx`。

**Interfaces:** Produces `getTaiwanSecurity(symbol: string): Promise<TaiwanSecurity | null>`、`getTaiwanQuote(symbol: string): Promise<TaiwanQuote | null>`、`searchTaiwanSecurities(query: string): Promise<StockWithWatchlistStatus[]>`、`getTaiwanHistory(symbol: string, days: number): Promise<TaiwanHistory>`、`getTaiwanDetails(symbol: string): Promise<TaiwanDetails | null>`。Reads 僅讀 repository；背景請求由 Task 4 明確入口觸發。Watchlist row 擴充 nullable price/change/changePercent/currency 與 `source`／`tradingDate`／`mode`，US rows 契約數值保留。

- [x] **1. 紅燈測試：** 無 Finnhub key 仍可搜台股／ETF；裸數字不當美股；中文命中；未同步且 DB 失敗不可宣稱無商品或觸發外部 API。自選 0050 有價格／TWD／日期，未知幣別不顯示 USD；quote null 與 zero change 區分。既有 2330.TW 加 TWSE:2330 不新增第二筆；其他使用者記錄不可讀／改。先回來的新搜尋結果不能被舊結果覆寫，composition Enter 不導航。
- [x] **2. 執行：** `npx vitest run lib/actions/taiwan-search.test.ts lib/actions/taiwan-watchlist.test.ts __tests__/taiwan-search-ui.test.tsx`；預期 FAIL。UI 使用 Node React renderer／可注入 request sequence pure helper，無需添加 DOM 套件。
- [x] **3. 實作：** 台股結果在 Finnhub 缺金鑰 return 前取得；非台股維持 Finnhub 路由，合併去重限制15筆。所有可觸發工作的 server action 保持已登入驗證；未初始化索引顯示準備中／同步未啟用，不拋 raw DB error。watchlist 查詢按 userId＋alias 判別，新增保存標準 symbol，已存在 alias 只回傳既有記錄而不再新增；新請求一律標準鍵 upsert 以既有唯一索引阻止並行重複，移除可作用於該使用者全部等價 alias。不批次改寫他人資料。`useLiveQuotes` 傳入排除台股的集合，避免15秒輪詢收盤；台股 row 以官方日期標示「收盤」，不以 Today 混淆。新增 pending search sequence／composition guard。
- [x] **4. 綠燈：** Step 2 PASS；mock 不允許台股觸發 Finnhub quote／company profile；跨市場混合自選 US／crypto 流程維持。有有效零漲跌時顯示 0，缺行情顯示 —。
- [x] **5. Commit：** `feat: search and price Taiwan watchlists from official data`。

### Task 6：指標與四因素切換官方日 K

**Files:** Modify `lib/candles/{symbols,types}.ts`、`lib/actions/alpaca.actions.ts`、`components/stocks/IndicatorDashboard.tsx`；Create `lib/taiwan/candles.ts`；Modify `lib/actions/candles-routing.test.ts`、`__tests__/market-indicators.test.tsx`；Create `lib/taiwan/candles.test.ts`。

**Interfaces:** Produces `officialTaiwanCandles(symbol: string, days: number): Promise<CandleResult>`；`CandleSource.provider` 新增 twse／tpex。`CandleMarket` taiwan 分支帶 exchange，保留現有 kind 與 symbol；純解析共用 Task 1。來源結果保留已存在 failure reason，回填狀態由 getTaiwanHistory 另取，不任意更改其他市場 reason。

- [x] **1. 紅燈：** `TWSE:0050`、`0050.TW` 同 bar 序列；TPEX 不走 TWSE；800／400 返回各自日界切片；未完成當日排除；volume 完整。R N=126、251根不足、252根最低126樣本、378根完整252樣本；新上市 N/A；一個 malformed bar 不丟整個有效序列。台股沒有 SPY 请求／FinMind 请求，US／BINANCE 與 CG: 原測試仍通過。
- [x] **2. 執行：** `npx vitest run lib/taiwan/candles.test.ts lib/actions/candles-routing.test.ts __tests__/market-indicators.test.tsx`；預期官方台股 case FAIL。
- [x] **3. 實作：** 從持久 repo 取完整日 K 轉 RawCandles，延用 normalizeCandles／契約但以台股 adapter 做 OHLC完整驗證。`TAIWAN_CANDLE_PROVIDER=official|finmind` 為過渡回復旗標，預設 official，只有明確 finmind 時走舊 provider；不得官方錯誤自動 fallback。來源 labels 新增 TWSE／TPEx。指標與四因素讀取同 canonical 集合；partial 且有足夠資料可計算，無資料另顯同步狀態。來源失敗保留 failure reason，不能故意 return 空陣列掩飾 api-error。
- [x] **4. 綠燈：** Step 2 PASS，加跑 `npx vitest run lib/indicators/factor-periods.test.ts lib/actions/factor-preferences.actions.test.ts`，結果 PASS；不改公式或偏好 schema。
- [x] **5. Commit：** `feat: compute Taiwan indicators from official daily history`。

### Task 7：台股收盤、圖表、ETF 詳情與同步狀態介面

**Files:** Create `components/stocks/Taiwan{Header,Chart,Details,HistoryStatus}.tsx`；Modify `components/stocks/StockHeader.tsx`、`app/(root)/stocks/[symbol]/page.tsx`；Test `__tests__/taiwan-stock-page.test.tsx`。

**Interfaces:** TaiwanHeader({security: TaiwanSecurity|null, quote: TaiwanQuote|null, symbol: string})；TaiwanChart({bars: TaiwanBar[], events: TaiwanEvent[]})；TaiwanDetails({details: TaiwanDetails|null})（type import 可改 alias 避免元件同名）；TaiwanHistoryStatus({symbol: string, initial: TaiwanHistoryStatus})。Actions 增加已登入 `getTaiwanPageData(symbol: string): Promise<{ security: TaiwanSecurity | null; quote: TaiwanQuote | null; history: TaiwanHistory; details: TaiwanDetails | null }>` 共用讀取及 `requestTaiwanHistoryAction(symbol, days): Promise<TaiwanHistoryStatus>` 包裝 Task 4，不曝露任意 jobKey 或上游 URL。

- [x] **1. 紅燈測試：** 0050 頁有官方收盤日／ETF 資訊／盤中補充來源，沒有公司 PE／1h 官方案例文案；6488 圖表 v 為精確股數；無資料顯明確原因；partial 顯 candleCount 與進度；disabled 提示同步尚未啟用；未知幣別不顯 USD。公告惡意 HTML 當純文字，外部網址拒絕 javascript:。
- [x] **2. 執行：** `npx vitest run __tests__/taiwan-stock-page.test.tsx __tests__/market-indicators.test.tsx`；預期新頁案例 FAIL。
- [x] **3. 實作：** 延用 Panel、cards、loading／重試模式與現有風格；原生 SVG 日 K 圖支援3月／1年／全部、價量與交易日 tooltip，固定日 K，空資料與只有一根不除零。保留獨立 TradingView symbol-info，文字「TradingView 報價，依其可用資料」；官方價格與時效獨立。台股分支不載原 financials／1h technicals／profile widget，改官方摘要；原新聞／Adanos 功能維持。回填只在明確已登入頁觸發一次，status client 在 tab 可見時每30秒讀 DB、最多20次，ready／error／disabled 停止，可手動重試；不能在每次輪詢重新排隊。停牌、分割與未調整價提示；DTO不含 Date。
- [x] **4. 綠燈＋手動驗收：** Step 2 PASS；本機 mock／已授權資料環境測 2330、0050、00400A、6488、00679B、外幣 ETF、小畫面、iframe 失效、failed job。記錄來源日期及 screenshot／觀察結果；環境未有資料不能拿空頁截圖當驗收完成。
- [x] **5. Commit：** `feat: show native official Taiwan market analysis`。

### Task 8：整合驗收、設定與切換交付

**Files:** Modify `README.md`、`AGENTS.md` 事件紀錄；Create `docs/taiwan-official-data-verification.md`；補充相關測試；部署驗收完成後再移除 `lib/candles/providers.ts` 中台股 FinMind 舊路徑與 README 專用 token 說明（僅有使用者明確回報驗收後執行）。

**Interfaces:** CLI、env、官方及過渡 rollback 說明引用 Tasks 3–7 已定義名稱，不新建第二套同步入口。

- [x] **1. 全範圍驗證：** `npm test`、`npm run lint`、`npm run build`；逐項記錄新失敗與既有失敗，外部 DB／env／網路限制時明確說明。所有新增 mock 測試不得需要真 key／正式 DB。`git diff --check` 無 whitespace error；檢查 staged diff 不含 temp、fixtures 完整全市場資料或憑證。
- [x] **2. 對照驗收：** 文件列出研究時已驗證的 endpoints，正式部署需驗的發布時間／配額／IP；給使用者最多5個頂層驗收步驟：免費額度與旗標、dry-run及指定範圍同步、搜尋與自選、日 K與指標、故障／來源日期。設定不預填費用未知的額度，沒有明確 budgets 時背景維持 disabled。零成本需要服務端超額計費關閉或可驗證的硬上限，本機工具不自動改方案。
- [x] **3. 回填成本與數值對照：** 記錄同日官方與過渡 FinMind 的 OHLCV 差異，以交易範圍／調整價／日期說明，不能為了數字一致改官方值。上櫃800日回填可能需數百個全日回應，確實列出 task／bytes dry-run 估算與每日上限造成的準備時間，不承諾一次開頁即完成。
- [x] **4. 完成範圍紀錄：** 更新 README data-source、免費同步、CLI與新 env、TradingView盤中限制；AGENTS.md 留≤10行量能範圍與官方日期案例。尚未部署／未實際同步、未驗收項目寫清楚。回復旗標保留至使用者部署驗收，移除舊 FinMind 為明確後續清理條件，不把未驗收當成已遷移完成。
- [x] **5. Commit：** `docs: document official Taiwan data setup and verification`；只本機提交，無 push／deploy。交付程式、計畫勾選狀態、測試結果、人工同步必要設定與尚未執行的正式驗收。

## 計畫自查

- Spec coverage：商品與來源 Task 1–2；資料與成本 Task 3–4；搜尋／自選 Task 5；400／800／R Task 6；原生頁與盤中補充 Task 7；交付與回復 Task 8。
- Interface consistency：所有 task 共用 TaiwanKey、TaiwanBar、TaiwanHistory 與 TaiwanRepository；上櫃 downloader 日期工作批次共用，不按單檔重抓。
- Review Focus：五項均已有所屬紅燈案例；race／預算、來源更正與IME另在相應task列明。
- 確認無需新增產品決策；實作仍須核對各財報產業 schema與 Inngest 當前 cron API，使用官方文件及最小公開 fixture。
- 本輪只寫計畫，未執行產品測試或實際同步；上櫃接口、成交股數與 ETF 主檔已公開只讀實測。

## 執行方式建議

建議 Native：由同一代理依序完成，各任務共享市場識別、預算與資料模型，適合維持同一份上下文；完成後再獨立審閱整體修改。另一方式是逐任務交給子代理與獨立審閱者，檢查更頻繁但增加代理上下文成本。依 writing-plans 的交接要求，使用者閱讀本計畫並選定執行方式後才進入 implementation skill。
