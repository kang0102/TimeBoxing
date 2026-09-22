# 按次授權的股票研究

每次研究先在網站預覽問題、上層分支、公開範圍與用量限制，再由 kang0102 在 GitHub 提交完整授權 Issue。搜尋與閱讀不會呼叫 AI。只有新建、由儲存庫本人提交且通過格式驗證的 Issue 會進入流程；重新開啟、修改、手動重跑都不能重用授權。

## 尚待啟用

1. 本人至 OpenAI 平台建立具 Responses 權限的專案 API 金鑰，設定專案預算／通知。不要貼進聊天、程式碼或網站。
2. 至本儲存庫 Settings → Secrets and variables → Actions 建立 `OPENAI_API_KEY` repository secret。
3. 確認 `rotation/ai_research.json` 的 `enabled` 設為 `true`。未完成時維持 `false`，前端只展示授權預覽。
4. 由本人在網站選一個問題、提交一次授權，檢查真實 API 回應、引用與費用。無金鑰測試只能驗證權限及結構，不能聲稱線上 AI 已驗收。

## 執行與限制

使用 `gpt-5.4-mini-2026-03-17`，一個 Responses 請求，最多 6 次網路工具呼叫、12,000 輸出 token（包括推理）。這些是用量限制而非美元封頂；另計輸入與搜尋費，依 OpenAI 帳單為準。每天最多接收 10 筆，沒有定期自動研究。未接受外部模型或預算參數。

一次授權包含回答該問題與更新研究總覽；後續分支只是建議。串接同股的所有已完成分支摘要，最多 80 支，超過需先整理而非無聲丟棄較早資料。人工材料、AI 陳述、推論、反例與缺口分列，來源網址必須能追溯到本次搜尋或引用。這僅檢查來源存在，不保證模型正確理解原文；不提供估計勝率或自動下單。

報告、研究問題與授權 Issue 是公開的。個人持股、成本、Firebase 判斷及帳號完全不進研究請求。請勿把私人資訊填入公開研究問題。API 使用 `store:false`；並不宣稱供應商零留存，仍適用供應商政策。

流程先在 Issue 記錄不可重用的嘗試標記、發布 running 狀態，再呼叫一次模型。失敗／逾時不重試；請求可能已產生費用。若 GitHub 在結果持久化前中斷，先查執行與帳單，不能因畫面仍是 running 就重跑付款。同一流程採用既有資料更新的互斥群組，不會並行覆寫研究檔。

## 驗證

`node --test tests/research_tree.test.js` 與 `python -m unittest discover -s tests -p 'test_stock_research.py'` 檢查授權、跨股分支、重跑、來源與工具限制，不呼叫付費 API。CI 仍執行原持股、策略與 Firestore 測試。

官方介面依據：[Responses 網路搜尋](https://developers.openai.com/api/docs/guides/tools-web-search)、[結構化輸出](https://developers.openai.com/api/docs/guides/structured-outputs)、[模型](https://developers.openai.com/api/docs/models/gpt-5.4-mini)、[GitHub Issues 事件](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#issues)。
