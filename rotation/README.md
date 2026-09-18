# 股票輪動雷達

首頁新增 `rotation.html` 入口。沿用 GitHub Pages，Python 在 GitHub Actions 執行，使用者電腦不必開機。

第一版：台股／美股 42 檔、8 個觀察族群，完整日線的相對強弱、成交量比、均線、突破、補漲候選與最多 30 次每日訊號紀錄。不是盤中報價、買賣指令、勝率或「行情反映完成度」。未移植 Backtest 的其他策略。

## 執行

Python 3.12：

```sh
pip install -r rotation/requirements.txt
python -m unittest discover -s tests -p 'test_rotation.py' -v
python scripts/update_rotation_data.py
python -m http.server 8765
```

開啟 `/rotation.html`。`universe.json` 維護觀察股票，`.TW` 為上市、`.TWO` 為上櫃。美股部分族群目前只有一個代表，畫面會註明。日線採 yfinance/Yahoo Finance，資料供個人研究，來源可用性、延遲與授權由供應商規範。

## 雲端更新

`Update stock rotation radar`：台股工作日 UTC 07:43、美股工作日 UTC 22:43（台北 15:43 與翌日 06:43），也可從 Actions 手動執行。排程僅 main 啟用；GitHub 排程可能延遲，公開儲存庫長期無活動也可能被停用，不具即時交易保證。

流程先跑測試、下载行情、排除未收盤 K 棒、原子寫入 `data.json`，再將結果提交 main 並要求現有 branch-based GitHub Pages 重建。需 repository Actions 允許 `contents: write` 與 `pages: write`。保留 `CNAME` 與現有網站。若未來改用 workflow-based Pages，需相應更換發布步驟。

部分股票失敗時保留舊值但顯示舊日期，排除族群計算、訊號篩選及補漲標記。全部失敗時仍發布錯誤狀態並令工作流程失敗。快照超過 36 小時會在頁面提醒；市場指數超過 5 個日曆日視為不足，因此長假會保守暫停該市場的評分。以各市場指數最後交易日對齊個股，不將缺漏日冒充新資料。

分數公式與每個訊號的門檻在頁面「分數、訊號與資料怎麼看」中完整列出；這是待回測的初始規則，未宣稱經回測有獲利能力。族群名單為研究分組，不構成任何供應鏈／訂單事實。

## 催化事件

不把舊對話中的新聞、估計分數或未查證關係當成目前事實。因此初始 `catalysts.json` 沒有事件，也沒有假資料。需人工核實後加入下列結構；目前沒有自動新聞蒐集。`verification=verified` 且有 HTTPS 來源、在 10 個市場交易日內才顯示。

```json
{
  "events": [{
    "id": "unique-event-id",
    "title": "已核實的事件標題",
    "date": "YYYY-MM-DD",
    "market": "TW",
    "verification": "verified",
    "sources": [{"title": "公司公告", "url": "https://官方來源/公告"}],
    "relationships": [{
      "symbol": "2330.TW",
      "wave": 1,
      "kind": "confirmed",
      "description": "來源確實支持的業務關係",
      "source": "https://官方來源/關係證據"
    }]
  }]
}
```

`wave` 可為 1／2／3，是研究者對事件傳導路徑的分類，不是模型自動確認的發生順序。`kind` 為 `confirmed` 或 `hypothesis`；已確認關係缺來源不顯示。程式只能檢查結構與日期，不能替代人核實來源。所有頁面文字均以 textContent 輸出，來源連結限制 HTTPS。

## 存取範圍

GitHub Pages 與本公開儲存庫的頁面、行情、名單、催化事件皆為公開內容。現有首頁 PIN 只是前端介面鎖，不是伺服器權限控管。本功能不加入任何帳戶、持倉、API 金鑰、私人聊天內容或新的密碼。若將來要放私人投資資料，須另建真正驗證使用者身分的後端。
