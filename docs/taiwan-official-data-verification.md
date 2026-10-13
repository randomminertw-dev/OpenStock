# 台股官方資料來源遷移驗證與交付指南

本文件記錄 RandomInvestigation 平台將台股行情與歷史資料遷移至臺灣證券交易所（TWSE）與證券櫃檯買賣中心（TPEx）官方公開資料來源之端點清單、使用者驗收步驟、成本與數值對照，以及交付範疇說明。

---

## 1. 已驗證之官方公開端點（Verified Endpoints）

本專案在實作與測試階段已完成資料契約與結構驗證之官方公開端點如下：

### 臺灣證券交易所（TWSE）
- **每日收盤行情快照**：`https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`（`twse-stock-day-all`，盤後暫存，標註 `complete: false`）
- **個股／ETF 月別日 K 歷史**：`https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date={YYYYMM01}&stockNo={code}`（`twse-stock-day`，完整日 K，標註 `complete: true`）
- **上市公司基本資料清單**：`https://mopsfin.twse.com.tw/opendata/t187ap03_L.csv`（`twse-company-list`）
- **上市 ETF 基本資料清單**：`https://mopsfin.twse.com.tw/opendata/t187ap47_L.csv`（`twse-etf-list`）
- **全市場本益比／淨值比／殖利率**：`https://www.twse.com.tw/exchangeReport/BWIBBU_ALL?response=json`（`twse-bwibbu`）
- **除權息與資本變更公告**：`https://www.twse.com.tw/exchangeReport/TWT48U_ALL?response=json`（`twse-exright`）
- **開休市行事曆**：`https://www.twse.com.tw/holidaySchedule/holidaySchedule?response=json`（`twse-holiday`）

### 證券櫃檯買賣中心（TPEx）
- **上櫃每日收盤行情快照**：`https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes`（`tpex-mainboard-daily-close-quotes`，盤後暫存，標註 `complete: false`）
- **全市場歷史日收盤與成交行情**：`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?date={YYYY/MM/DD}&response=json`（`tpex-daily-quotes`，單次回傳上櫃全市場，供追蹤商品集合批次共用，標註 `complete: true`）
- **上櫃公司基本資料清單**：`https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O`（`tpex-company-list`）
- **上櫃 ETF 篩選主檔**：`https://info.tpex.org.tw/api/etfFilter`（`tpex-etf-list`）
- **上櫃本益比與殖利率分析**：`https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis`（`tpex-peratio`）
- **上櫃除權息預告表**：`https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost`（`tpex-exright`）

> **正式部署提示**：正式線上部署時，需依據主機環境驗證各端點發布時間、公開 IP 存取限制與頻率配額，避免同一 IP 短時間密集請求觸發上邏輯限速。

---

## 2. 使用者驗收流程（5 個頂層驗收步驟）

為確保系統在零額外費用、安全配額與完整資料品質下運行，使用者或維運者請依序執行以下 5 個驗收步驟：

### 步驟一：免費配額與旗標配置檢查（Free Quota and Flags Configuration）
確認 `.env` 中的環境變數配置：
```env
# 歷史與背景同步旗標（預設維持停用，避免未設預算即觸發背景消耗）
TAIWAN_AUTO_SYNC_ENABLED=false
TAIWAN_HISTORY_ENABLED=false

# 來源切換旗標（預設 official；可設定 finmind 進行緊急回退）
TAIWAN_CANDLE_PROVIDER=official

# 嚴格正整數預算限制（任一缺漏或非正整數，系統即安全停用背景同步）
TAIWAN_MAX_REQUESTS_PER_DAY=200
TAIWAN_MAX_JOBS_PER_DAY=50
TAIWAN_MAX_TRANSFER_BYTES_PER_DAY=104857600   # 100 MB
TAIWAN_MAX_STORAGE_BYTES=1073741824          # 1 GB
TAIWAN_MAX_TRACKED_SECURITIES=200
TAIWAN_MAX_RESPONSE_BYTES=15728640           # 15 MB
```
- **驗證要點**：
  1. 所有 `TAIWAN_MAX_*` 必須為明確之正整數。
  2. 若無設定或設為 0 / 負數，系統回傳 `missing-config` 或 `disabled`，絕不自動升級付費方案或超額抓取。

### 步驟二：CLI Dry-Run 檢視與指定範圍同步（Dry-Run and Specified Scope Sync）
使用本機 CLI 檢查同步計畫，不存取資料庫亦不發送任何外部網路請求：
```bash
npm run taiwan:sync -- --dry-run --symbols TWSE:2330,TWSE:0050,TPEX:6488,TPEX:00679B --days 800
```
- **驗證要點**：
  1. CLI 輸出顯示 `[DRY-RUN]` 與排程任務數量（如 626 個 URL/任務單位）。
  2. 檢查 TWSE 股票按月份批次劃分，TPEX 股票按交易日共用全市場查詢。
  3. 若需對實際 DB 執行同步，必須明確指定 `--apply` 與 `--target <label>`：
     ```bash
     npm run taiwan:sync -- --apply --target staging --symbols TWSE:2330,TWSE:0050 --days 800
     ```
     若未帶 `--apply` 或 `--target`，CLI 立即終止並以 exit code 1 安全退出。

### 步驟三：搜尋與自選清單驗證（Search and Watchlist Verification）
啟動應用程式（或於測試案例中驗證）檢驗商品搜尋與自選行情：
- **搜尋檢驗**：
  1. 於頂部搜尋列或 Command + K 輸入中文名稱：「台積電」、「元大台灣50」、「環球晶」、「元大美債20年」。
  2. 輸入市場別名與裸代號：「2330」、「0050」、「6488」、「00679B」、「2330.TW」、「TPEX:6488」。
  3. 驗證無 Finnhub API Key 時，台股商品仍能透過官方目錄正常檢索；裸代號不被誤判為美股；注音輸入選字 Enter 時不觸發意外頁面跳轉。
- **自選清單檢驗**：
  1. 將 `TWSE:2330` 與 `TPEX:6488` 加入自選。
  2. 嘗試重複加入等價代號（如 `2330.TW`），確認不會產生重複列。
  3. 自選列正確標示「收盤」、官方交易日期與「TWD」幣別（若為外幣 ETF 則標示實際交易幣別），無行情時顯示「—」而非 `$0.00`。

### 步驟四：日 K 圖表與 57 項技術指標計算（Daily Candles & Technical Indicators）
進入台股個股詳情頁面（例如 `/stocks/TWSE:2330`、`/stocks/TWSE:0050`、`/stocks/TPEX:6488`）：
- **原生 SVG 圖表**：
  1. 正確呈現官方歷史日 K 線與成交量長條圖，支援 3M / 1Y / ALL 週期切換。
  2. 成交量顯示精確成交股數（非千股乘數）；滑鼠懸停顯示開高低收與交易日期。
- **57 項技術指標與四因素（Trend / Momentum / Volume / Volatility Risk）**：
  1. 評分與指標均基於官方未調整價（unadjusted price）與成交股數計算。
  2. 台股不與美股 SPY 錯位比較，Beta / RS / RRG 保持 N/A。
  3. 波動度風險（R）在資料充足時計算真實 ATR%，支援多週期（7/14/20/21/28）切換。
- **ETF 與基本資訊**：ETF 頁面顯示淨值與追蹤標的，不顯示個股本益比；所有公告內容均以純文字渲染防範 XSS。

### 步驟五：故障處理與資料時效性（Failure Handling & Data Freshness）
測試各種資料缺漏或非交易時段狀態：
- **時效保留**：非交易日或今日盤後資料尚未更新時，系統保留最後已確認官方交易日，不捏造假 K 線，亦不將取回當下時間偽裝為今日交易日。
- **同步狀態反饋**：若歷史資料尚在回填中，詳情頁清楚顯示 `partial` 及已完成根數；若未配置或配額耗盡，顯示 `missing-config` 或 `budget-limit`，並保留手動重試入口。
- **快速回復（Rollback）驗證**：若在 `.env` 中設定 `TAIWAN_CANDLE_PROVIDER=finmind`，系統日 K 與指標立即安全切換至 FinMind 舊路徑，搜尋與自選維持官方目錄不中斷。

---

## 3. 回填成本與數值對照（Backfill Cost & Value Comparison）

### OHLCV 數值精度對照
| 比較項目 | 官方來源（TWSE / TPEX） | 過渡來源（FinMind） | 影響與設計原則 |
|---|---|---|---|
| **成交量（Volume）** | **精確成交股數（Shares）**<br>來自 TWSE `成交股數` 與 TPEX `成交股數` | **成交張數（Lots）**<br>常以張為單位或乘 1,000 推算 | 官方來源提供真實零股與整股精確交易量。指標計算（OBV、CMF、Volume Factor）使用真實股數，不可為了與舊版一致將官方值改回估算張數。 |
| **價格基準（Price Basis）** | **未調整收盤價（Unadjusted）** | **未調整收盤價（Unadjusted）** | 兩者皆為未調整收盤價；遇除權息或分割事件時於介面提供提示，不自動反推分割假價格。 |
| **日期日界（Timezone）** | **Asia/Taipei（交易日）** | **Asia/Taipei（交易日）** | 當日 OpenAPI 即時快照為 `complete: false`；盤後結算報告確認後為 `complete: true`。 |

### 回填成本與時間估算（以 800 日曆天為例）
- **歷史保留上限**：系統設計歷史保存上限為 1,000 日曆天（約 4 年交易日）。
- **TWSE 回填**：
  - 端點按月查詢（`STOCK_DAY`），每檔股票 800 日曆天約需 27 個月份請求。
  - 核心追蹤標的（例如 2330 與 0050）僅需約 54 次輕量請求（總計約 2-4 MB）。
- **TPEX 回填特點與限制**：
  - 端點為全市場每日收盤（`dailyQuotes`），800 日曆天約有 550~570 個交易日。
  - 每次全市場回應約 1.5 MB ~ 2.5 MB（未解壓縮）。
  - 若需回填完整 800 日上櫃歷史，需發送 **550+ 次全市場請求**，總傳輸量約 **1.1 GB ~ 1.4 GB**。
  - **重要提醒**：在每日免費配額 `TAIWAN_MAX_REQUESTS_PER_DAY=200` 與 `TAIWAN_MAX_TRANSFER_BYTES_PER_DAY=100MB` 的限制下，上櫃 800 日全量回填無法在「單次開頁」或單日內完成，需分批在 3~6 個工作日透過背景或 CLI 逐步回填完畢。本機 CLI 工具與背景排程均受原子預算控制，絕不超支。

---

## 4. 交付範圍與尚未執行項目聲明（Delivery Scope & Pending Items）

### 已完成交付內容
1. **官方公開轉接器與正規化模組**（`lib/taiwan/`）：TWSE 與 TPEX OpenAPI / 盤後歷史資料解析、日期與數值正規化。
2. **完整商品目錄與搜尋**：上市公司、上櫃公司及上市櫃 ETF 主檔索引，支援中文名稱、代號與多種市場別名檢索。
3. **安全持久儲存與原子預算管理**：MongoDB 模型、唯一鍵防重抓、Lease 機制、保守流量與次數限制。
4. **盤後同步引擎與本機 CLI**：支援 Dry-run 檢查、指定商品與天數回填、排程同步規格。
5. **官方日 K 指標引導與原生介面**：57 項技術指標與四因素分析無縫切換官方資料；原生 SVG 日 K 走勢圖與 ETF 詳情面板。
6. **過渡回復機制**：保留 `TAIWAN_CANDLE_PROVIDER=official|finmind` 旗標以備緊急回滾。

### 尚未部署／未於正式環境同步之項目（待使用者手動驗收）
- **未執行線上 Clasp / Vercel 部署**：程式碼僅完成本機實作與單元／整合測試，未執行 `git push` 或線上部署。
- **未對正式資料庫寫入全市場資料**：測試過程使用 Mock 資料與小規模公開 Fixture，未向真實 MongoDB 寫入正式全市場歷史。
- **背景同步旗標預設維持 `disabled`**：生產環境需要維運人員確認資料庫容量與伺服器預算後，於環境變數明確啟用 `TAIWAN_AUTO_SYNC_ENABLED=true` 與 `TAIWAN_HISTORY_ENABLED=true`。
- **FinMind 舊路徑保留**：`lib/candles/providers.ts` 中之 FinMind 相關備援路徑仍保留，待使用者於正式環境驗收完成並確認無需 Rollback 後，再由後續維護任務進行清理。
