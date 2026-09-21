/* Dated exchange observations and ETF plans; no AI calls or order placement. */
(() => {
  'use strict';
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e;};
  const num=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:d}):'—';
  const pct=n=>Number.isFinite(n)?`${n>0?'+':''}${num(n)}%`:'—';
  const localParts=()=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const clock=()=>{const p=localParts(),day=`${p.year}-${p.month}-${p.day}`,minutes=Number(p.hour)*60+Number(p.minute);return {day,minutes,weekend:[0,6].includes(new Date(day+'T12:00:00Z').getUTCDay())};};
  const time=t=>t?new Date(t).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'未取得';
  const changed=e=>(e?.new_funds?.length||0)+(e?.increased_funds?.length||0)+(e?.reduced_funds?.length||0)>0;
  let filter='focus';
  function fresh(report){const c=clock(),age=Date.now()-Date.parse(report?.generated_at);return report?.status==='ok'&&report.session_date===c.day&&!c.weekend&&c.minutes>=540&&age>=0&&(c.minutes>815||age<=20*60000);}
  function quote(report,symbol){
    if(!fresh(report))return null;
    const q=report.stocks?.find(r=>r.symbol===symbol),c=clock();
    if(q?.status!=='ok'||q.quote_date!==c.day)return null;
    if(c.minutes<=815&&Date.now()-Date.parse(q.quote_at)>20*60000)return null;
    return q;
  }
  const signalLabels={breakout:'暫時突破 · 等收盤',fade:'衝高回落 · 不追',defend:'跌破防守參考',hot:'偏熱 · 不追',wait:'等待確認',unknown:'資料未齊'};
  function renderSession(data,etf,report,market){
    const view=document.getElementById('session-panel');view.replaceChildren();view.hidden=market!=='TW';if(view.hidden||!data)return;
    const c=clock(),daily=data.markets.TW?.as_of,isFresh=fresh(report),live=isFresh?(report.stocks||[]).filter(r=>quote(report,r.symbol)):[];
    view.append(el('p','盤前準備 → 盤中預警 → 收盤確認','eyebrow'),el('h2',c.weekend?'休市期間：準備下一個交易日':c.minutes<540?'盤前：先訂價位，再等開盤':c.minutes<=815?'今天盤中：誰突破，誰轉弱？':'今日報價已收盤，接著核對完整日線'));
    const steps=el('div',null,'session-steps');
    for(const [title,text]of [['① 盤前準備',`完整日線 ${daily}；先看前高、月線與已公布 ETF 動向。`],['② 盤中預警',isFresh?`${report.session_date} · 本次可判斷 ${live.length}/${report.coverage.total} 檔。報價不等於收盤訊號。`:c.weekend||c.minutes<540?'開盤後才會產生今天的報價。':'目前沒有新鮮的當日快照；等待雲端更新，不用舊價判斷。'],['③ 收盤確認',daily===c.day?'當日日線已計算；法人與 ETF 持股仍須看各自日期。':'預定 14:13、15:43 與晚間補抓完整資料，排程可能延遲。']]){const box=el('div');box.append(el('strong',title),el('p',text));steps.append(box);}view.append(steps);
    view.append(el('p',`交易時段目標每 15 分鐘計算 · 雲端抓取 ${report?.generated_at?new Date(report.generated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚未取得'}。行情另看個股成交時間，超過 20 分鐘暫停盤中判定。`,'detail-note'));
    const focus=new Set([...(etf?.overlap||[]).filter(changed).map(e=>e.code),...(data.briefings||[]).filter(b=>b.market==='TW').flatMap(b=>b.items.map(i=>i.symbol.split('.')[0]))]);
    const controls=el('div',null,'map-filters');for(const [id,title]of [['focus','主線＋ETF 動向'],['alert','突破／回落提醒'],['all','全部台股']]){const b=el('button',title);b.type='button';b.setAttribute('aria-pressed',String(filter===id));b.onclick=()=>{filter=id;renderSession(data,etf,report,market);};controls.append(b);}view.append(controls);
    if(!isFresh){
      const prep=el('div',null,'session-prep');
      for(const r of data.stocks.filter(r=>r.market==='TW'&&focus.has(r.symbol.split('.')[0])&&r.status==='ok').slice(0,6)){const box=el('div');box.append(el('strong',r.name),el('p',`前高參考 ${num(r.next_session_high20)} · 月線 ${num(r.ma20)}`));prep.append(box);}view.append(prep,el('p','以上是已知日線的準備價位，並非今天已觸發。國定假日或來源中斷時，沒有當日報價便不判斷。','notice'));return;
    }
    view.append(el('p',`加權指數 ${num(report.index.price)} · ${pct(report.index.change_pct)} · ${time(report.index.quote_at)}${c.minutes>815?'（收盤附近報價）':''}`,'session-index'));
    const rows=(report.stocks||[]).filter(r=>filter==='all'||filter==='focus'&&focus.has(r.symbol.split('.')[0])||filter==='alert'&&quote(report,r.symbol)&&['breakout','fade','defend','hot'].includes(r.signal));
    const grid=el('div',null,'live-grid');
    for(const row of rows){const q=quote(report,row.symbol),card=el('article',null,`live-card ${q?.signal||'unknown'}`);card.append(el('h3',`${row.name} ${row.symbol.split('.')[0]}`),el('span',q?(q.signal==='breakout'&&c.minutes>815?'報價突破 · 看日線確認':signalLabels[q.signal]):'報價未齊／已過期',`decision-tag ${q?.signal==='breakout'?'watch':q?.signal==='wait'?'':'hot'}`));
      if(q){card.append(el('strong',`${num(q.price)}　${pct(q.change_pct)}`),el('small',`${time(q.quote_at)} · 相對大盤當日 ${pct(q.relative_today_pct)}`),el('p',q.reason),el('p',`突破參考 ${num(q.high20)}｜防守參考 ${num(q.ma20)}`),el('small',`基準 ${q.baseline_as_of} · 累計量／全日均量 ${num(q.volume_progress_ratio)}×（非同時段量比）`));}
      else card.append(el('p',row.reason||'暫不判斷'));
      grid.append(card);
    }view.append(grid);if(!rows.length)view.append(el('p','此篩選目前沒有符合股票。'));
    const source=el('a','報價來源：證交所基本市況報導');source.href='https://mis.twse.com.tw/stock/index.jsp';source.target='_blank';source.rel='noopener noreferrer';view.append(source,el('p','盤中暫時突破不代表買入已確認；尚未回測盤中策略。成交量只顯示累計進度，不拿半天的量直接判成全日量縮。ETF 與法人沿用各自最新公布日，不代表此刻的交易。','evidence-boundary'));
  }
  const actionLabels={follow:'可考慮跟進',wait:'先等確認',avoid:'先避開追買',defend:'先防守',unknown:'資料不足',unchanged:'無新增動向'};
  function renderETF(view,data,report,intraday,showTiming){
    if(!data)return;
    const all=[...data.stocks,...(report.extra_stocks||[])],same=report.status==='ok'&&report.as_of===data.markets.TW?.as_of&&RotationDecisions.dailyFresh(data,'TW');
    const candidates=(report.overlap||[]).filter(changed).map(e=>{const r=all.find(r=>r.market==='TW'&&r.symbol.split('.')[0]===e.code)||{symbol:e.code,name:e.name,market:'TW',status:'unavailable'};let a=RotationDecisions.etfAction(r,same?data.markets.TW.as_of:null,e);const q=quote(intraday,r.symbol);
      if(q&&['defend','fade','hot'].includes(q.signal)&&a.action!=='unknown')a={...a,action:q.signal==='defend'?'defend':'avoid',reason:`當天報價：${q.reason}。${clock().minutes<=815?'收盤前仍可能改變。':'請核對下方完整日線條件。'}`};
      else if(a.action==='follow'&&report.as_of!==clock().day)a={...a,action:'wait',reason:'上次收盤條件成立；今天仍需重新確認，先不把舊買點當成現在的買點。'};
      return {e,r,a,q};});
    const ready=candidates.filter(x=>x.a.action==='follow'),wait=candidates.filter(x=>x.a.action==='wait'),defend=candidates.filter(x=>['avoid','defend'].includes(x.a.action)),unknown=candidates.filter(x=>x.a.action==='unknown');
    const holdingDates=[...new Set(report.funds.map(f=>f.holding?.as_of).filter(Boolean))].sort();
    const hero=el('div',null,'etf-stock-hero');hero.append(el('p',`持股日期 ${holdingDates.join('、')||'未取得'} · 行情／淨值 ${report.as_of} · ${report.holdings_coverage}/${report.funds.length} 檔有持股資料`,'eyebrow'),el('h3',ready.length?`${ready.length} 檔可評估跟進，其餘先等或防守`:'目前沒有可直接跟進的確認訊號'),el('p',`${wait.length} 檔先等確認 · ${defend.length} 檔先避開／防守${unknown.length?` · ${unknown.length} 檔資料未齊`:''}。先看誰在調整，再看股價是否配合。`));view.append(hero);
    if(holdingDates.some(d=>d<report.as_of))view.append(el('p','今天的持股尚未全部公布，保留最近一次實際公布的動向，搭配最新價格觀察；不能說基金今天仍在買或賣。','notice'));
    if(!same)view.append(el('p','持股與日線尚未對齊，以下動向保留原日期；暫不給出新的跟進／防守判斷。','notice warn'));
    view.append(el('h3','他們在做什麼？'));
    const flow=el('div',null,'fund-flow-grid');
    for(const fund of report.funds.filter(f=>f.holding?.status==='ok')){const box=el('article',null,'fund-flow');box.append(el('strong',`${fund.code} ${fund.name}`));const up=candidates.filter(x=>[...(x.e.new_funds||[]),...(x.e.increased_funds||[])].some(f=>f.code===fund.code));const down=candidates.filter(x=>(x.e.reduced_funds||[]).some(f=>f.code===fund.code));
      box.append(el('small',fund.holding.comparison_as_of?`${fund.holding.comparison_as_of} → ${fund.holding.as_of}`:'持股比較日期未齊'));
      box.append(el('p',`增加曝險：${up.map(x=>x.r.name).join('、')||'未見達門檻的增加'}`,'flow-up'),el('p',`減少曝險：${down.map(x=>x.r.name).join('、')||'未見達門檻的減少'}`,'flow-down'));
      if(!fund.holding.comparison_as_of&&!up.length&&!down.length)box.append(el('small','缺少比較日，不能判定沒有動作。'));flow.append(box);
    }view.append(flow,el('p','同一基金的增加／減少並列，表示已公布持股的變化；不代表已追蹤資金從哪檔流向哪檔。門檻為每受益單位股數變動 1%，降低基金申贖的干擾。','detail-note'));
    const board=el('div',null,'etf-action-board');
    for(const [title,items,cls,empty]of [['可考慮跟進',ready,'follow','目前沒有。等價量成立、未過熱，且法人不偏賣。'],['先等確認',wait,'wait','目前沒有等待中的候選。'],['先避開／防守',defend,'defend','目前未見這類提醒；不代表沒有風險。']]){const lane=el('section',null,`action-lane ${cls}`);lane.append(el('h3',`${title} · ${items.length} 檔`));if(!items.length)lane.append(el('p',empty));
      for(const {e,r,a,q}of items){const card=el('article',null,'action-stock');card.append(el('h4',`${r.name} ${e.code}`),el('strong',actionLabels[a.action]),el('p',a.reason));
        for(const f of [...(e.new_funds||[]),...(e.increased_funds||[]),...(e.reduced_funds||[])])card.append(el('small',`${f.code} · ${f.previous_date} → ${f.as_of} · ${Number.isFinite(f.per_unit_change_pct)?`每單位持股 ${pct(f.per_unit_change_pct)}`:'新納入'} · 權重 ${num(f.previous_weight_pct)}% → ${num(f.weight_pct)}%`));
        if(q)card.append(el('p',`當天 ${num(q.price)} · ${time(q.quote_at)}；月線參考 ${num(q.ma20)}`));
        card.append(el('p',a.action==='follow'?'尚未持有：先評估分批，不追大幅跳空。':a.action==='wait'?'尚未持有：先放觀察名單，等下面條件。':'尚未持有：暫不跟買，不因基金持有就接跌勢。'),el('p',`已持有：${a.action==='defend'&&q?.signal==='defend'?'價格已跌破防守參考，檢查減碼／退出計畫。':`關注月線 ${num(q?.ma20??r.ma20)}，失守時重新評估持有；不是看到單一基金減少就立刻全賣。`}`));
        const b=el('button','看具體價位與取消條件');b.type='button';b.onclick=()=>showTiming(r,e);card.append(b);lane.append(card);
      }board.append(lane);
    }view.append(board);
    if(unknown.length)view.append(el('p',`暫不判定：${unknown.map(x=>x.r.name).join('、')}。價格或持股日期不足。`,'notice'));
    view.append(el('p','目前持股僅野村 00980A、00985A、00999A 三檔同投信樣本；其餘基金方向未知。單日增加不代表持續加碼，權重大增也可能來自低基期。ETF＋價格的進退規則尚未回測；不提供必漲機率或自動下單。','evidence-boundary'));
  }
  window.RotationLive={renderSession,renderETF,fresh,quote};
})();
