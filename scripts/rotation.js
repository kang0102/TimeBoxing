/* All provider/user text is inserted with textContent, never HTML interpolation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {breakout:'放量突破', improving:'動能轉強', extended:'漲幅偏熱', weakening:'轉弱觀察', watch:'等待訊號'};
  const state = {data:null, backtest:null, holding:10, market:'TW', group:'all', stage:'all', money:'all', query:'', descending:true};
  const make = (tag, text, cls) => { const e=document.createElement(tag); if(text!=null)e.textContent=text; if(cls)e.className=cls; return e; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const num = (n,d=1) => finite(n) ? n.toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const pct = n => finite(n) ? `${n>0?'+':''}${num(n,2)}%` : '—';
  const colored = n => n>0?'pos':n<0?'neg':'';
  const current = () => (state.data?.stocks||[]).filter(r=>r.market===state.market);
  const safeLink = (url,label) => {let e=make('span',label);try {const u=new URL(url);if(u.protocol==='https:'){e=make('a',label);e.href=u.href;e.target='_blank';e.rel='noopener noreferrer';}} catch {}return e;};
  function badge(stage){return make('span',labels[stage]||'等待資料',`badge ${stage||''}`);}
  const lots = n => finite(n)?`${n>0?'+':''}${num(n/1000,1)} 張`:'—';
  function moneyLabel(m){
    if(!m||m.status!=='ok')return '資料不足';
    return m.method==='institutional'?({buying:'法人偏買',selling:'法人偏賣',mixed:'法人方向分歧'}[m.bias]):({buying:'量價買壓',selling:'量價賣壓',mixed:'量價中性'}[m.bias]);
  }
  function moneyBlock(r,withPrice=false){
    const m=r.smart_money,box=make('div',null,'money-cell');box.append(make('span',moneyLabel(m),`money-badge ${m?.status==='ok'?m.bias:'unknown'}`));
    if(m?.status==='ok'){
      box.append(make('small',m.method==='institutional'?`外資＋投信 5 日 ${lots(m.core_net_5d)}`:`CMF20 ${num(m.cmf_20d,3)} · 量價推估`));
      if(m.method==='institutional')box.append(make('small',`近 5 日買超 ${m.buy_days} 日 · 連買 ${m.buy_streak===5?'≥5':m.buy_streak} 日`));
      if(withPrice)box.append(make('small',m.price_confirmed?'價格：站上月線且相對大盤轉強':'價格：轉強條件尚未同時成立'));
    }else box.append(make('small',m?.method==='institutional'?`法人資料 ${m?.coverage||0}/5 日 · 尚不判定`:'指標資料未齊'));
    if(m?.as_of)box.append(make('small',`指標日期 ${m.as_of}`));
    return box;
  }
  function setGroup(id){state.group=id;$('group').value=id;render();}
  function render(){
    const rows=current(), valid=rows.filter(r=>r.status==='ok');
    document.querySelectorAll('[data-market]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.market===state.market)));
    const groups=state.data.groups.filter(g=>g.market===state.market);
    $('group').replaceChildren(new Option('全部族群','all'),...groups.map(g=>new Option(g.name,g.id)));
    if(!groups.some(g=>g.id===state.group))state.group='all';
    $('group').value=state.group;
    $('stage').value=state.stage;
    $('money').value=state.money;
    const moneyCount=valid.filter(r=>r.smart_money?.status==='ok').length;
    $('money-description').textContent=state.market==='TW'?`Smart Money＝法人籌碼 · 以外資＋投信近 5 日方向交叉觀察輪動 · 完整資料 ${moneyCount}/${rows.length} 檔 · 缺資料不判斷。`:`Smart Money 參考＝CMF20 量價買賣壓力 · 完整資料 ${moneyCount}/${rows.length} 檔 · 屬量價推估，尚未接入機構持股資料。`;
    const asOf=state.data.markets[state.market]?.as_of||'尚未取得';
    const oldSnapshot=Date.now()-Date.parse(state.data.generated_at)>36*3600000;
    const marketInfo=state.data.markets[state.market];
    const delayed=marketInfo?.status==='delayed';
    const warn=state.data.status!=='ok'||oldSnapshot||delayed;
    $('notice').className=`notice${warn?' warn':''}`;
    $('notice').textContent=`${state.market==='TW'?'台股':'美股'}行情日期：${asOf} · 完整日線 · 有效資料 ${valid.length}/${rows.length} 檔。${delayed?` 官方已公布 ${marketInfo.expected_as_of}，來源仍落後，暫停最新訊號。`:''}${oldSnapshot?' 雲端已超過 36 小時未更新，以下為歷史觀察。':''}${valid.length<rows.length?' 部分資料未更新，已排除在訊號與族群評分之外。':''}`;
    const counts=[['行情日期',asOf],['放量突破',`${valid.filter(r=>r.stage==='breakout').length} 檔`],['補漲轉強',`${valid.filter(r=>r.laggard).length} 檔`],['相對落後',`${valid.filter(r=>r.laggard_watch).length} 檔`]];
    $('stats').replaceChildren(...counts.map(([k,v])=>{const e=make('div',null,'stat');e.append(make('span',k),make('strong',v));if(k==='行情日期')e.lastChild.style.fontSize='1.35rem';return e;}));
    $('groups').replaceChildren(...[...groups].sort((a,b)=>(b.score??-1)-(a.score??-1)).map(g=>{
      const e=make('button',null,`group-card${state.group===g.id?' active':''}`);e.type='button';e.setAttribute('aria-pressed',String(state.group===g.id));
      const top=make('div',null,'group-top');top.append(make('h3',g.name),make('strong',num(g.score,0)));
      const meter=make('div',null,'meter'),fill=make('i');fill.style.width=`${Math.max(0,Math.min(100,g.score||0))}%`;meter.append(fill);
      e.append(top,meter,make('p',`5 日相對大盤 ${pct(g.rs_5d)}`),make('p',`站上均線 ${num(g.breadth,0)}% · ${g.usable}/${g.count} 檔${g.count===1?'（單一代表）':''}`));
      if(g.status!=='ok')e.append(make('p','資料不足，暫不評分'));
      e.addEventListener('click',()=>setGroup(state.group===g.id?'all':g.id));return e;
    }));
    $('stages').replaceChildren(...['watch','improving','breakout','extended','weakening'].map(s=>{
      const e=make('button',null,'stage-box');e.type='button';e.setAttribute('aria-pressed',String(state.stage===s));e.append(make('small',labels[s]),make('strong',String(valid.filter(r=>r.stage===s).length)));e.addEventListener('click',()=>{state.stage=state.stage===s?'all':s;render();});return e;
    }));
    const filtered=rows.filter(r=>(state.group==='all'||r.group===state.group)&&(state.stage==='all'||(r.status==='ok'&&(['laggard','laggard_watch'].includes(state.stage)?r[state.stage]:r.stage===state.stage)))&&(state.money==='all'||(state.money==='unavailable'?r.smart_money?.status!=='ok':r.smart_money?.status==='ok'&&r.smart_money.bias===state.money))&&`${r.symbol} ${r.name}`.toLowerCase().includes(state.query.toLowerCase()));
    filtered.sort((a,b)=>{if(a.status!==b.status)return a.status==='ok'?-1:b.status==='ok'?1:0;return state.descending?(b.score??-1)-(a.score??-1):(a.score??101)-(b.score??101);});
    $('stocks').replaceChildren(...filtered.map(r=>{
      const tr=make('tr'),name=make('td'),price=make('td'),score=make('td'),rs=make('td'),vol=make('td'),signal=make('td'),money=make('td'),action=make('td');
      money.dataset.label='Smart Money';money.append(moneyBlock(r));
      for(const [cell,label]of [[price,'收盤／日漲跌'],[score,'動能分數'],[rs,'相對大盤 5 日'],[vol,'成交量比'],[signal,'訊號']])cell.dataset.label=label;
      name.append(make('strong',r.name),make('small',`${r.symbol} · ${r.group_name}`));
      price.append(make('strong',num(r.close,2)),make('small',pct(r.change_1d),colored(r.change_1d)));
      if(r.status==='ok'){score.append(make('strong',num(r.score)),make('small','/ 100'));rs.append(make('span',pct(r.rs_5d),colored(r.rs_5d)));vol.textContent=`${num(r.volume_ratio,2)}×`;signal.append(badge(r.stage));if(r.laggard_watch)signal.append(make('span',r.laggard?'補漲轉強':'相對落後，待轉強','laggard'));}
      else{score.textContent='—';rs.textContent='—';vol.textContent='—';signal.append(make('span',r.status==='stale'?'舊資料':'缺少資料','badge'));price.append(make('small',r.as_of||'未取得'));}
      const button=make('button','查看');button.type='button';button.setAttribute('aria-label',`查看${r.name}明細`);button.addEventListener('click',()=>showDetail(r));action.append(button);tr.append(name,price,score,rs,vol,signal,money,action);return tr;
    }));
    $('result-count').textContent=`${filtered.length} 檔 · ${state.market==='TW'?'TWD':'USD'}`;$('empty').hidden=filtered.length>0;
    $('sort-score').textContent=`動能分數 ${state.descending?'↓':'↑'}`;
    renderBriefing();
    renderSynchrony();
    renderBacktest();
    renderResearch();
    renderEvents();
  }
  function renderBriefing(){
    const view=$('briefing'),brief=(state.data.briefings||[]).find(b=>b.market===state.market);
    view.replaceChildren();
    if(!brief){
      const box=make('div',null,'brief-hero');box.append(make('h2',state.market==='US'?'美股：先看量價，傳導路徑待建立':'研究摘要尚未建立'),make('p','目前沒有可核實的波次候選圖。可展開下方完整清單查看價格與資金面。'));
      view.append(box);return;
    }
    const items=brief.items,focus=brief.focus_symbols.map(symbol=>items.find(i=>i.symbol===symbol));
    const active=['waiting','diffusing','weakening'].includes(brief.status);
    const phase={diffusing:'第 3 波已出現接棒訊號',waiting:'第 2 波領先，等待第 3 波接棒',weakening:'領先股轉弱，主線先降級',pending:'等待研究開始後的完整行情',expired:'研究追蹤期已結束',unavailable:'資料未齊，暫不判定'}[brief.status];
    const hero=make('div',null,'brief-hero');hero.append(make('p',`${brief.as_of||'日期待確認'} 收盤觀察 · 封測／AI ASIC 測試`,'eyebrow'),make('h2',focus.length?`下一棒先看：${focus.map(i=>i.name).join('、')}`:phase),make('p',focus.length?phase:'目前沒有通過初步條件的下一棒候選。'));
    hero.append(make('small','這是條件觀察名單；波次為研究路徑，並非上漲機率。'));view.append(hero);
    const cards=make('div',null,'opportunity-grid');
    for(const item of focus){
      const card=make('article',null,`opportunity-card ${item.category}`),head=make('div',null,'opportunity-head');
      head.append(make('h3',item.name),make('span',item.wave?`第 ${item.wave} 波 · 接棒觀察`:'另一路觀察','path-tag'));card.append(head);
      card.append(make('p',`收盤 ${num(item.close,2)} · ${pct(item.change_1d)} · ${item.symbol}`,'detail-note'));
      const reasons=['站上 20 日均線','近 5 日強於大盤'];if(item.money_bias==='buying')reasons.push('外資＋投信偏買');else if(item.money_bias==='selling')reasons.push('但外資＋投信偏賣，籌碼尚未配合');else reasons.push('法人方向尚未一致');
      card.append(make('p',`為什麼觀察：${reasons.join('，')}。`,'opportunity-reason'));
      const passed=item.checks.filter(c=>c.passed).length;
      card.append(make('h4',passed===item.checks.length?'條件已成立，接著看能否守住':`還在等什麼？已達 ${passed}/${item.checks.length} 項條件`));
      const checks=make('div',null,'trigger-list');
      for(const c of item.checks){
        let title,actual;
        if(c.kind==='breakout'){title=`收盤突破 ${num(c.target,2)} 元`;actual=`目前 ${num(c.actual,2)}${c.passed?'，已突破':`，距前高約 ${num(item.gap_to_high,2)}%`}`;}
        else if(c.kind==='ma20'){title=`收盤站回月線 ${num(c.target,2)} 元`;actual=`目前 ${num(c.actual,2)}`;}
        else if(c.kind==='volume'){title=`量比維持 ${num(c.target,1)} 倍以上`;actual=`目前 ${num(c.actual,2)} 倍`;}
        else{title='近 5 日持續強於大盤';actual=`目前相對大盤 ${pct(c.actual)}`;}
        const line=make('div',null,`trigger ${c.passed?'met':'waiting'}`);line.append(make('span',c.passed?'✓':'待','trigger-icon'));const text=make('div');text.append(make('strong',title),make('small',actual));line.append(text);checks.append(line);
      }
      card.append(checks,make('p',`何時降級：若收盤跌回月線 ${num(item.ma20,2)} 元以下，先撤出優先觀察。`,'invalidation'));
      if(item.category==='ready')card.append(make('p',`已觸發也要觀察隔日是否跌回 ${num(item.high20,2)} 元下方。`,'detail-note'));
      const button=make('button','查看行情與籌碼');button.type='button';button.setAttribute('aria-label',`查看機會卡${item.name}明細`);button.addEventListener('click',()=>showDetail(state.data.stocks.find(r=>r.symbol===item.symbol)));card.append(button);cards.append(card);
    }
    view.append(cards);
    const path=make('section',null,'transmission');path.append(make('h2','這條主線走到第幾波？'),make('p','箭頭表示研究上的接棒路徑；每家公司是否啟動，另外看當天條件。','detail-note'));
    const grid=make('div',null,'path-grid'),status={anchor:'大型股錨點',leader:'領先觀察',leader_hot:'已領先 · 漲幅偏熱',hot:'已啟動 · 漲幅偏熱',ready:'接棒條件成立',watch:'下一棒 · 等待突破',wait:'先等止跌／轉強',unavailable:'尚未判定'};
    for(const [wave,title]of [[1,'大型股錨點'],[2,'領先股'],[3,'接棒與落後觀察']]){
      const lane=make('div',null,`path-lane wave-${wave}`);lane.append(make('p',`第 ${wave} 波`,'path-number'),make('h3',title));
      for(const item of items.filter(i=>i.wave===wave)){
        const node=make('div',null,`path-stock ${item.category}`);node.append(make('strong',item.name),make('span',status[item.category]||'待確認'));
        if(finite(item.change_1d))node.append(make('small',`當日 ${pct(item.change_1d)}`));lane.append(node);
      }grid.append(lane);
    }path.append(grid);view.append(path);
    const waiting=items.filter(i=>['wait','hot'].includes(i.category));
    if(waiting.length){const section=make('section',null,'wait-section');section.append(make('h2','其餘名單：現在先等什麼？'));const list=make('div',null,'wait-list');
      for(const item of waiting){const row=make('div',null,'wait-row');row.append(make('strong',item.name),make('span',item.category==='hot'?'已啟動，漲幅偏熱':'先等轉強',`path-tag ${item.category}`));
        let text;if(item.category==='hot')text=`${item.close>item.high20?`已突破前高 ${num(item.high20,2)} 元`:'漲幅或月線乖離偏大'}；20 日漲幅 ${pct(item.return_20d)}。${item.close>item.high20?'接著觀察能否守住突破價。':'先等價格整理與量價重新確認。'}`;
        else if(brief.status==='weakening')text='主線領先股失守，先等領先股穩住，再重新驗證接棒條件。';
        else text=`目前 ${num(item.close,2)} 元。${item.close<=item.ma20?`先收盤站回月線 ${num(item.ma20,2)} 元`:'已站上月線'}${item.rs_5d<=0?'，且近 5 日表現轉為強於大盤':''}。`;
        row.append(make('p',text));list.append(row);
      }section.append(list);view.append(section);}
    if(active)view.append(make('p','以上均以完整收盤資料判斷，價位與條件每日重算。歷史績效與交易成本請看回測區。','brief-footnote'));
  }
  function renderSynchrony(){
    const view=$('synchrony'),all=(state.data.synchrony||[]).filter(s=>s.market===state.market);
    view.replaceChildren(make('h2','異常同步：有沒有一群一起動？'));
    view.append(make('p','同族群至少 3 檔放量、走強，且各自強於大盤；再看參與比例是否突然增加。法人配合另外確認。','detail-note'));
    const active=all.filter(s=>!['quiet','insufficient'].includes(s.status)).sort((a,b)=>Number(b.status.includes('anomaly'))-Number(a.status.includes('anomaly'))||b.up_count-a.up_count);
    if(!active.length)view.append(make('p','本次沒有達到門檻的族群同步；不代表沒有個股機會。','notice'));
    const cards=make('div',null,'sync-grid');
    const names=symbols=>symbols.map(s=>state.data.stocks.find(r=>r.symbol===s)?.name||s).join('、');
    for(const s of active){
      const down=s.status.startsWith('down'),box=make('article',null,`sync-card${down?' risk':''}`);
      const label=s.status.includes('anomaly')?(down?'異常同步轉弱':'異常同步轉強'):(down?'多檔一起轉弱':'多檔一起轉強');
      box.append(make('span',`${s.as_of} · ${label}`,'path-tag'),make('h3',s.name),make('strong',`${down?s.down_count:s.up_count} / ${s.total} 檔符合量價條件`),make('p',names(down?s.down_symbols:s.up_symbols)));
      if(!down){box.append(make('p',`目前參與 ${num(s.up_count/s.total*100,0)}% · 前 20 日平均 ${num(s.baseline_pct,0)}%`,'detail-note'));
        box.append(make('p',s.money_confirmed.length?`${state.market==='TW'?'法人偏買配合':'CMF 買壓配合（推估）'}：${names(s.money_confirmed)}`:'資金面尚未配合或資料不足。','sync-money'));
        if(s.money_divergence.length)box.append(make('p',`價格與資金方向分歧：${names(s.money_divergence)}。`,'invalidation'));
      }else box.append(make('p','這是風險提醒：先看同族群是否繼續失守月線。','invalidation'));
      cards.append(box);
    }view.append(cards);
    const details=make('details',null,'method');details.append(make('summary','同步門檻與觀察範圍'));
    details.append(make('p','先要求至少 80% 成員有完整資料。轉強成員：當日上漲且漲幅大於大盤、量比 ≥ 1.5、5 日相對大盤 > 0、收盤在月線上。至少 3 檔且占族群 60% 才稱同步。'));
    details.append(make('p','「異常」另外要求：參與比例比此前 20 日平均增加至少 25 個百分點，且增幅達此前標準差的 2 倍。轉弱採反向條件。這是固定觀察門檻，沒有統計顯著性或因果保證；不是判定主力操盤。'));
    const insufficient=all.filter(s=>s.status==='insufficient');if(insufficient.length)details.append(make('p',`樣本少於 3 檔或資料不足：${insufficient.map(s=>s.name).join('、')}。`));
    view.append(details);
  }
  function renderBacktest(){
    const view=$('backtest');view.replaceChildren(make('h2','短波段與中期：回測怎麼說？'));
    const report=state.backtest?.markets?.find(m=>m.market===state.market);
    if(!report){view.append(make('p','回測尚未取得或載入失敗；目前不顯示績效數字。','notice'));return;}
    const age=Date.now()-Date.parse(state.backtest.generated_at);
    view.append(make('p',`量價接棒代理規則 · ${report.available}/${report.total} 檔 · 驗證 ${report.validation_start} ～ ${report.validation_end}`,'detail-note'));
    view.append(make('p','回測只檢查量價規則；新聞傳導、人工波次與法人條件尚未完成歷史驗證。今天挑的觀察名單回看歷史，也有事後選股偏差。','notice'));
    if(age>9*86400000)view.append(make('p','回測超過 9 天未更新，請先查看雲端執行紀錄。','notice warn'));
    if(report.data_gaps?.length)view.append(make('p',`來源缺價 ${report.data_gaps.join('、')}；隔開缺漏並重新累積 65 日資料後才開始驗證，因此台股驗證期間較短。`,'detail-note'));
    const grid=make('div',null,'backtest-grid');
    for(const row of report.results){
      const r=row.validation,button=make('button',null,`backtest-card${state.holding===row.holding_days?' selected':''}`);button.type='button';button.setAttribute('aria-pressed',String(state.holding===row.holding_days));
      button.append(make('span',`最長持有 ${row.holding_days} 個交易日`),make('strong',pct(r.return_pct),colored(r.return_pct)),make('small',`最深回落 ${pct(r.max_drawdown_pct)}`),make('small',`${r.trades} 筆 · 勝率 ${num(r.win_rate_pct,1)}%`),make('span',{insufficient:'樣本仍少',needs_revision:'結果未過關',forward_test:'待前瞻驗證'}[row.assessment],'backtest-assessment'));
      button.addEventListener('click',()=>{state.holding=row.holding_days;renderBacktest();});grid.append(button);
    }view.append(grid);
    const selected=report.results.find(r=>r.holding_days===state.holding)||report.results[0];
    view.append(make('h3',`最長 ${selected.holding_days} 日 · 扣成本後的模擬資金走勢`));
    const svg=chart(selected.validation.curve.map(p=>({...p,value:p.value-100})));svg.setAttribute('aria-label',`最長持有 ${selected.holding_days} 日驗證期累積報酬走勢`);view.append(svg);
    const dates=make('div',null,'chart-dates');dates.append(make('span',report.validation_start),make('span',report.validation_end));view.append(dates);
    view.append(make('p',`成本加倍後 ${pct(selected.double_cost_return_pct)} · 同期大盤價格指數 ${pct(report.benchmark_return_pct)}（基準口徑不同，非純超額報酬）。`,'detail-note'));
    const sync=selected.synchrony_filter;
    if(sync){const box=make('div',null,'sync-comparison');box.append(make('h3','加上「異常同步」有比較好嗎？'),make('p',`原規則 ${pct(selected.validation.return_pct)} / ${selected.validation.trades} 筆 → 加同步門檻 ${pct(sync.return_pct)} / ${sync.trades} 筆`),make('p',`同步版最深回落 ${pct(sync.max_drawdown_pct)}。${sync.trades<20?'同步樣本少於 20 筆，還不能下結論。':'本次僅作比較，尚未升級成正式交易規則。'}`,'detail-note'),make('p',`只有族群樣本至少 3 檔可測，共涵蓋 ${report.synchrony_eligible_stocks} 檔；加入門檻也會改變交易次數與資金使用。`,'detail-note'));view.append(box);}
    const detail=make('details',null,'method');detail.append(make('summary','交易規則、成本與持續修正方式'));
    detail.append(make('p',state.backtest.settings.description),make('p',`最多同時 ${state.backtest.settings.max_positions} 檔、每檔目標占資金 1/5，不借錢；單邊成本假設 ${num(report.one_way_cost_pct,2)}%。期末強制結清 ${selected.validation.forced_exits} 筆。報酬非年化，最長持有天數會因跌破月線而提前離場。`));
    detail.append(make('p',`訓練 ${report.train_start} ～ ${report.train_end}。量比候選 1.2／1.5／2.0 只在訓練期比較，驗證期另看結果。此持有期訓練選出的量比為 ${selected.candidate.volume_ratio}，驗證報酬 ${pct(selected.candidate.validation_return_pct)}；候選尚未套用。`));
    detail.append(make('p','GitHub 每週六台北 09:23 重跑並保留紀錄，排程可能延遲。四種持有期與同步版本固定並列；不因單次績效較高就自動調參。修正前要記錄原因、保留原版，並再看新的前瞻資料。'));
    for(const text of state.backtest.limitations||[])detail.append(make('p',text));
    detail.append(safeLink('https://github.com/kang0102/TimeBoxing/actions/workflows/backtest-rotation.yml','查看雲端回測執行紀錄'),make('p',`計算時間：${new Date(state.backtest.generated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（台北） · ${state.backtest.strategy_version}`,'detail-note'));
    view.append(detail);
  }
  function renderResearch(){
    const cases=(state.data.research_cases||[]).filter(c=>c.market===state.market);
    const statusNames={waiting:'領先股守住基準，等待接棒',diffusing:'量價擴散條件成立',weakening:'領先股失守觀察基準',unavailable:'資料不足，暫不判定',expired:'追蹤期已結束',pending:'等待首個完整交易日'};
    if(!cases.length){$('research').replaceChildren(make('p',state.market==='US'?'美股目前追蹤下方已核實事件及量價；尚未建立美股專屬的接棒研究主線。':'尚無研究主線。','event-empty'));return;}
    $('research').replaceChildren(...cases.map(c=>{
      const article=make('article',null,'research-card');
      const head=make('div',null,'research-head');head.append(make('h3',c.title),make('span',statusNames[c.status]||c.status,`research-status ${c.status}`));article.append(head);
      article.append(make('p',`研究時間：${new Date(c.report_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（台北） · 行情：${c.as_of||'缺少資料'} · 已追蹤 ${c.trading_days}/${c.max_sessions} 個交易日`,'detail-note'));
      article.append(make('p',c.thesis),make('h4','原報告研究優先序 · 不等於今日買進排名'));
      const list=make('div',null,'priority-list');
      for(const p of [...c.positions].filter(p=>p.priority).sort((a,b)=>a.priority-b.priority)){
        const row=state.data.stocks.find(r=>r.symbol===p.symbol),card=make('div',null,'priority-card');
        const title=make('div',null,'priority-top');title.append(make('span',String(p.priority),'rank'),make('strong',p.name),make('span',p.role,'badge'));card.append(title,make('p',p.observation,'current-observation'));
        if(row?.status==='ok')card.append(make('p',`${row.as_of} · ${row.symbol} · 收盤 ${num(row.close,2)} · 日 ${pct(row.change_1d)}`,'detail-note'),make('p',`量比 ${num(row.volume_ratio,2)}× · 20 日 ${pct(row.return_20d)}`,'detail-note'),make('p',`該日收盤${row.above_ma20?'站上':'未站上'} MA20 ${num(row.ma20,2)}`,'detail-note'));
        else card.append(make('p','行情未更新，不能判定轉強。','detail-note'));
        if(row)card.append(moneyBlock(row,true));
        card.append(make('p',p.report_view,'report-view'));
        const b=make('button','行情與評分明細');b.type='button';b.setAttribute('aria-label',`查看研究名單${p.name}明細`);b.disabled=!row;b.addEventListener('click',()=>showDetail(row));card.append(b);list.append(card);
      }
      article.append(list);
      const details=make('details',null,'research-details');details.append(make('summary','輪動路徑、每日驗證條件與證據邊界'));
      const map=make('div',null,'wave-grid');for(const wave of [1,2,3,0]){const lane=make('div',null,'wave-lane');lane.append(make('h4',wave?`第 ${wave} 波 · 研究角色`:'另一路觀察'));for(const p of c.positions.filter(p=>p.wave===wave)){lane.append(make('strong',`${p.name} · ${p.role}`),make('p',p.observation));if(p.source)lane.append(safeLink(p.source,'已確認的既有合作來源'));}map.append(lane);}details.append(map);
      const checks=make('div',null,'check-list');for(const check of c.checks){const item=make('div',null,'check-item');item.append(make('span',check.passed===true?'符合':check.passed===false?'未符合':'無法判定',`check-state ${check.passed===true?'pass':check.passed===false?'pending':''}`),make('strong',check.name),make('span',check.label));if(finite(check.observed))item.append(make('small',`實際 ${num(check.observed,2)}${check.unit}`));checks.append(item);}details.append(checks);
      details.append(make('p',`規則：兩檔領先股皆守住 ${c.baseline_date} 收盤的 ${100+c.rules.leader_floor_pct}%（回吐不超過 ${Math.abs(c.rules.leader_floor_pct)}%），且京元電或日月光至少一檔符合放量突破條件，才標記「量價擴散條件成立」。資料不足不判定；這是可修改的初始觀察規則，尚未回測。`,'detail-note'),make('p',c.evidence_note,'evidence-boundary'));
      article.append(details);return article;
    }));
  }
  function renderEvents(){
    const events=(state.data.events||[]).filter(e=>(e.markets||[e.market]).includes(state.market));
    if(!events.length){const e=make('div',null,'event-empty');e.append(make('strong','目前沒有已核實、仍在追蹤期間內的催化事件'),make('p','量價雷達持續觀察。新增附來源的事件後，這裡會顯示第一波、第二波、第三波的關係與個股訊號。'));$('events').replaceChildren(e);return;}
    $('events').replaceChildren(...events.map(event=>{const card=make('details',null,'event');card.append(make('summary',event.title),make('p',`官方公告 ${event.published_date||event.date} · 台股觀察自 ${event.date} 起 · ${event.trading_days===0?'等待事件後首個完整交易日資料':`第 ${event.trading_days} 個交易日`}`));
      if(event.summary)card.append(make('p',event.summary));if(event.boundary)card.append(make('p',event.boundary,'evidence-boundary'));
      for(const source of event.sources)card.append(safeLink(source.url,source.title||'公開來源'),make('span',' '));
      for(const wave of [1,2,3]){card.append(make('h4',`第 ${wave} 波 · 關係路徑假設`));const list=make('ul');for(const r of event.relationships.filter(x=>x.wave===wave)){const stock=state.data.stocks.find(s=>s.symbol===r.symbol);const li=make('li',`${stock?.name||r.symbol}｜${r.kind==='confirmed'?'關係已確認':'需求延伸假設，非已確認供應商'}｜${r.description||''}｜${stock?.status==='ok'?labels[stock.stage]:'資料不足'}`);if(r.source)li.append(make('span',' '),safeLink(r.source,'關係來源'));list.append(li);}if(!list.children.length)list.append(make('li','沒有足夠證據建立此波觀察公司'));card.append(list);}return card;}));
  }
  function showDetail(r){
    const box=$('detail-content');box.replaceChildren(make('p',`${r.symbol} · ${r.group_name}`,'eyebrow'),make('h2',r.name),make('p',`行情日期 ${r.as_of||'尚未取得'} · ${r.currency}`,'detail-note'));
    if(r.price_repair)box.append(make('p',r.price_repair.note,'detail-note'),safeLink(r.price_repair.source,'核對官方收盤來源'));
    if(r.status!=='ok'){box.append(make('p',`未納入目前訊號：${r.error||'資料未更新'}`,'notice warn'));}
    else{box.append(badge(r.stage));const grid=make('div',null,'detail-grid');for(const [label,value]of [['動能分數',`${num(r.score)} / 100`],['20 日漲幅',pct(r.return_20d)],['5 日相對大盤',pct(r.rs_5d)],['20 日相對大盤',pct(r.rs_20d)],['成交量比',`${num(r.volume_ratio,2)}×`],['MA20 乖離',pct(r.ma20_distance)]]){const e=make('div');e.append(make('span',label),make('strong',value));grid.append(e);}box.append(grid);
      const list=make('ul');for(const reason of r.reasons)list.append(make('li',reason));box.append(list,make('h3','近 20 個交易日相對大盤走勢'),make('p','起點設為 0%，向上代表相對大盤轉強。','detail-note'));box.append(chart(r.series));
      box.append(make('h3','分數組成'),make('p',`相對強弱 ${num(r.components.relative_strength)} / 35 · 動能加速 ${num(r.components.acceleration)} / 20 · 均線 ${num(r.components.trend)} / 20 · 成交量 ${num(r.components.volume)} / 15 · 突破 ${num(r.components.breakout)} / 10`,'detail-note'));
    }
    box.append(make('h3','Smart Money · 資金面交叉觀察'),moneyBlock(r,true));
    const m=r.smart_money;
    if(m){
      box.append(make('p',m.note,'detail-note'));
      if(m.method==='institutional'){
        if(m.status==='ok'){
          const grid=make('div',null,'detail-grid');for(const [key,label]of [['foreign','外資 5 日'],['trust','投信 5 日'],['dealer','自營商 5 日'],['total','三大法人 5 日']]){const cell=make('div');cell.append(make('span',label),make('strong',lots(m.net_5d[key])));grid.append(cell);}box.append(grid,make('p',`外資與投信 5 日合計同步買超：${m.joint_buying?'是':'否'}。自營商含避險部位，另列參考。`,'detail-note'));
        }
        const history=make('div',null,'money-history');for(const h of [...(m.history||[])].reverse()){const line=make('div');line.append(make('strong',h.date),make('span',`外資 ${lots(h.foreign)} · 投信 ${lots(h.trust)}`),make('small',`自營商 ${lots(h.dealer)} · 三大法人 ${lots(h.total)}`));history.append(line);}box.append(history);
        box.append(make('p','單位為張（股數÷1,000）。上市／上櫃成交統計範圍依官方報表，原始報表可由下方連結核對。','detail-note'));
      }
      box.append(safeLink(m.source,m.source_name));
    }
    box.append(make('h3','每日訊號紀錄'));
    const history=make('div',null,'history');for(const h of [...(r.history||[])].reverse()){const e=make('div',h.date);e.append(make('strong',num(h.score)),make('span',labels[h.stage]||h.stage));history.append(e);}box.append(history);if(!history.children.length)box.append(make('p','尚未累積歷史紀錄。'));
    box.append(safeLink(`https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}/history/`,'查看行情來源'));
    $('detail').showModal();
  }
  function chart(series){
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 580 160');svg.setAttribute('role','img');svg.setAttribute('aria-label','近 20 個交易日相對大盤報酬走勢');svg.classList.add('chart');
    if(!series?.length)return svg;
    const values=series.map(p=>p.value),lo=Math.min(0,...values),hi=Math.max(0,...values),range=hi-lo||1;
    const y=v=>135-(v-lo)/range*110;
    const line=document.createElementNS(ns,'line');for(const [k,v]of Object.entries({x1:44,x2:558,y1:y(0),y2:y(0),stroke:'#b7c8d3','stroke-dasharray':'4 4'}))line.setAttribute(k,v);svg.append(line);
    const path=document.createElementNS(ns,'polyline');path.setAttribute('points',values.map((v,i)=>`${44+i/(values.length-1||1)*514},${y(v)}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke','#08798a');path.setAttribute('stroke-width','3');svg.append(path);
    for(const [v,py]of [[hi,20],[lo,150]]){const text=document.createElementNS(ns,'text');text.setAttribute('x','0');text.setAttribute('y',py);text.setAttribute('font-size','13');text.setAttribute('fill','#52677a');text.textContent=`${num(v)}%`;svg.append(text);}return svg;
  }
  async function load(){
    const button=$('refresh');button.disabled=true;button.textContent='讀取中…';
    const backtestLoad=fetch(`rotation/backtest.json?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)}).then(r=>{if(!r.ok)throw new Error('backtest unavailable');return r.json();}).then(data=>{state.backtest=data;renderBacktest();}).catch(()=>{state.backtest=null;renderBacktest();});
    try{const response=await fetch(`rotation/data.json?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.schema_version!==1||!Array.isArray(data.stocks)||!Array.isArray(data.groups)||!data.markets||!Number.isFinite(Date.parse(data.generated_at)))throw new Error('Invalid snapshot');state.data=data;
      $('updated').textContent=`雲端計算：${new Date(data.generated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（台北）`;render();
    }catch{ $('notice').className='notice warn';$('notice').textContent=state.data?'更新失敗，畫面保留上次成功讀取的資料；請留意行情日期。':'目前無法載入輪動資料。首次雲端更新尚未完成，或網路暫時無法連線，請稍後再試。';if(!state.data){$('updated').textContent='尚未取得雲端結果';$('events').replaceChildren(make('p','資料載入後顯示已核實的催化事件。','event-empty'));}}
    finally{await backtestLoad;button.disabled=false;button.textContent='重新讀取';}
  }
  document.querySelectorAll('[data-market]').forEach(b=>b.addEventListener('click',()=>{state.market=b.dataset.market;if(state.data)render();}));
  $('money').addEventListener('change',e=>{state.money=e.target.value;if(state.data)render();});
  $('group').addEventListener('change',e=>{state.group=e.target.value;if(state.data)render();});$('stage').addEventListener('change',e=>{state.stage=e.target.value;if(state.data)render();});$('search').addEventListener('input',e=>{state.query=e.target.value;if(state.data)render();});$('sort-score').addEventListener('click',()=>{state.descending=!state.descending;if(state.data)render();});$('refresh').addEventListener('click',load);$('close-detail').addEventListener('click',()=>$('detail').close());
  load();
})();
