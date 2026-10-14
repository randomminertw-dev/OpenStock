# Repository Guidelines

## 專案結構

RandomInvestigation 是 OpenStock 的衍生市場研究平台，使用 Next.js 15 App Router、React 19、TypeScript 與 MongoDB。

- `app/`：頁面、路由、API 與全域樣式；`(auth)/` 管理驗證頁面。
- `components/`：React 元件；`ui/` 放共用 UI，其他子目錄依功能分類。
- `lib/actions/`：伺服器操作與行情供應商整合；`lib/indicators/`、`lib/factors/` 放指標計算與評分。
- `database/`：資料庫連線與 Mongoose models；`hooks/`、`types/` 放共用 hooks 與型別。
- `public/`：靜態資產；`scripts/`：維運工具；`__tests__/` 與相鄰的 `*.test.ts`：測試。

## 開發與驗證指令

使用 Node.js 20+，依 `package-lock.json` 執行 `npm ci` 安裝依賴。

- `npm run dev`：以 Turbopack 啟動開發伺服器，預設為 `localhost:3000`。
- `npm run build`：建立正式版本；完成後以 `npm start` 啟動。
- `npm run lint`：執行 ESLint 的 Next.js 與 TypeScript 規則。
- `npm test`：執行一次 Vitest；`npm run test:watch`：持續監看測試。
- `npm run test:db`：檢查已設定的 MongoDB 連線，需要有效環境設定。

## 程式風格與命名

TypeScript 已啟用 `strict`；根目錄匯入可使用 `@/`。延續所在檔案的縮排與引號風格：目前同時存在兩格與四格縮排，避免無關的整檔重排。元件採 PascalCase（如 `StockHeader.tsx`），hooks 採 `useXxx`，操作模組採 `*.actions.ts`。優先重用 `components/ui/`，指標計算保持純函式。專案未設定 Prettier，以 ESLint 與既有程式風格為準。

## 測試規範

Vitest 使用 Node 環境；測試檔命名為 `*.test.ts`，放在模組旁或 `__tests__/`。例如 `npx vitest run lib/actions/alpaca.actions.test.ts` 可執行指定測試。API 測試應 mock 外部請求及資料庫依賴，涵蓋資料不足、供應商錯誤與備援行為。尚未設定覆蓋率門檻；修改行為時補上相關測試，UI 變更另附手動驗證結果。

## Commit 與 Pull Request

沿用 Git 歷史的 `feat:`、`fix:`、`docs:` 前綴，描述具體結果，可使用繁體中文。每次提交聚焦單一目的。PR 請說明問題、修改內容、驗證指令與結果；有相關 issue 時附上連結，UI 變更附截圖，設定變更列出必要環境變數。提交前檢查 diff，避免納入暫存檔與無關修改。

## 設定與代理協作

依 `README.md` 設定本機 `.env`；不得提交 API keys、資料庫憑證或真實使用者資料。伺服器機密不可使用 `NEXT_PUBLIC_` 前綴。執行資料遷移或寄信腳本前，確認目標環境與副作用。代理一律使用繁體中文回覆，保留英文程式識別字；宣稱修復時附驗證證據，未執行的檢查須明確註記。

## 事件紀錄

- 2026-10-13：R=0 是歷史分位最低，不等於零波動；卡片以獨立 `atrPct` 顯示主值，排名僅作副資訊；未滿 126 筆仍可顯示已算出的 ATR%。
- 2026-10-13：提醒測試仍檢查舊 `OpenStock Cloud` 文案；功能已改為 realtime mode 提示時，應依實際產品契約更新測試預期，不改動提醒啟用邏輯。
- 2026-10-13：IDS-Period 的 `null` 可能是全中立、ATR 無方向或資料不足，前端須區分；週期變體實際為原始 ATR，勿標 ATR%。期間探索的 N 切換只選取預先算好的日 K 列，須明示選取值與方向，不影響其他評分。
- 分類總覽為 Server Component，不得從 `'use client'` 的 `IndicatorTable` 讀 `CATEGORY_LABEL`；共用標籤須放無 client directive 的模組，並驗證六類名稱與展開明細。
- 2026-10-13：四因素儲存後刷新失敗，重試成功須同步更新評分、套用摘要與儲存標記；Binance 非空但全 malformed 小時 K 應回報 `api-error`，空資料／全未收盤仍為 `no-data`。
- 2026-10-13：Crypto N 是 K 線根數；週期切換保留 T/M/V/R 的 N 並逐項顯示約略涵蓋時間，長線僅指技術觀察。Binance 混合無效列須逐列過濾，不能整批拒絕。
- 2026-10-13：四因素評分 action 即使 resolve `api-error` 也須保留已儲存狀態與重試入口；連續刷新失敗不得重複儲存。
- 2026-10-13：四因素設定請求期間停用草稿控制；儲存與評分刷新分開回報、失敗可單獨重試。市場偏好 `saved` 只在合法已存文件時為 true，讀取失敗與未存預設為 false。
- 2026-10-13：Crypto 分頁實際傳入 `BINANCE:`，不能只測 `CG:`；台股報價 widget 正常不代表後端已有歷史 K 線。
- 日 K 按市場分流：Binance 原交易對、FinMind 台股、Alpaca 美股／CG；錯誤原因須保留至 UI。台股／crypto 不與 SPY 尾端錯位比較；跨市場驗收執行 `__tests__/market-indicators.test.tsx`，即時來源驗證另見 README。
- 2026-10-14：台股遷移官方來源（TWSE／TPEX）：成交量採精確股數（成交股數），日 K 為未調整價、Asia/Taipei 日界；OpenAPI 快照 complete: false，盤後歷史確認後 complete: true，無資料保留 N/A 不填假 K 線。
- 2026-10-14：台股日 K 優先讀取 MongoDB 官方歷史，過渡旗標保留 TAIWAN_CANDLE_PROVIDER=official|finmind（預設 official），官方失敗不自動 fallback；背景同步預設 disabled，正式部署前只在本機 dry-run 驗證，禁止主動 push/deploy。
- 2026-10-14：台股索引未初始化／讀取失敗不能用 thrown Server Action 傳使用者訊息（production 會遮蔽）；搜尋改用結構化結果，無報價頁面不宣稱有收盤。CLI 在 fork 前載入 Next env；初始化須含 --catalog，--target 僅標籤、local 為非持久測試資料庫。
