/* All provider/user text is inserted with textContent, never HTML interpolation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = {breakout:'放量突破', improving:'動能轉強', extended:'漲幅偏熱', weakening:'轉弱觀察', watch:'等待訊號'};
  const state = {data:null, market:'TW', group:'all', stage:'all', query:'', descending:true};
  const make = (tag, text, cls) => { const e=document.createElement(tag); if(text!=null)e.textContent=text; if(cls)e.className=cls; return e; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const num = (n,d=1) => finite(n) ? n.toLocaleString('zh-TW',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
  const pct = n => finite(n) ? `${n>0?'+':''}${num(n,2)}%` : '—';
  const colored = n => n>0?'pos':n<0?'neg':'';
  const current = () => (state.data?.stocks||[]).filter(r=>r.market===state.market);
  const safeLink = (url,label) => {let e=make('span',label);try {const u=new URL(url);if(u.protocol==='https:'){e=make('a',label);e.href=u.href;e.target='_blank';e.rel='noopener noreferrer';}} catch {}return e;};
  function badge(stage){return make('span',labels[stage]||'等待資料',`badge ${stage||''}`);}
  function setGroup(id){state.group=id;$('group').value=id;render();}
  function render(){
    const rows=current(), valid=rows.filter(r=>r.status==='ok');
    document.querySelectorAll('[data-market]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.market===state.market)));
    const groups=state.data.groups.filter(g=>g.market===state.market);
    $('group').replaceChildren(new Option('全部族群','all'),...groups.map(g=>new Option(g.name,g.id)));
    if(!groups.some(g=>g.id===state.group))state.group='all';
    $('group').value=state.group;
    $('stage').value=state.stage;
    const asOf=state.data.markets[state.market]?.as_of||'尚未取得';
    const oldSnapshot=Date.now()-Date.parse(state.data.generated_at)>36*3600000;
    const warn=state.data.status!=='ok'||oldSnapshot;
    $('notice').className=`notice${warn?' warn':''}`;
    $('notice').textContent=`${state.market==='TW'?'台股':'美股'}行情日期：${asOf} · 完整日線 · 有效資料 ${valid.length}/${rows.length} 檔。${oldSnapshot?' 雲端已超過 36 小時未更新，以下為歷史觀察。':''}${valid.length<rows.length?' 部分資料未更新，已排除在訊號與族群評分之外。':''}`;
    const counts=[['行情日期',asOf],['放量突破',`${valid.filter(r=>r.stage==='breakout').length} 檔`],['補漲觀察',`${valid.filter(r=>r.laggard).length} 檔`],['轉弱觀察',`${valid.filter(r=>r.stage==='weakening').length} 檔`]];
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
    const filtered=rows.filter(r=>(state.group==='all'||r.group===state.group)&&(state.stage==='all'||(r.status==='ok'&&(state.stage==='laggard'?r.laggard:r.stage===state.stage)))&&`${r.symbol} ${r.name}`.toLowerCase().includes(state.query.toLowerCase()));
    filtered.sort((a,b)=>{if(a.status!==b.status)return a.status==='ok'?-1:b.status==='ok'?1:0;return state.descending?(b.score??-1)-(a.score??-1):(a.score??101)-(b.score??101);});
    $('stocks').replaceChildren(...filtered.map(r=>{
      const tr=make('tr'),name=make('td'),price=make('td'),score=make('td'),rs=make('td'),vol=make('td'),signal=make('td'),action=make('td');
      for(const [cell,label]of [[price,'收盤／日漲跌'],[score,'動能分數'],[rs,'相對大盤 5 日'],[vol,'成交量比'],[signal,'訊號']])cell.dataset.label=label;
      name.append(make('strong',r.name),make('small',`${r.symbol} · ${r.group_name}`));
      price.append(make('strong',num(r.close,2)),make('small',pct(r.change_1d),colored(r.change_1d)));
      if(r.status==='ok'){score.append(make('strong',num(r.score)),make('small','/ 100'));rs.append(make('span',pct(r.rs_5d),colored(r.rs_5d)));vol.textContent=`${num(r.volume_ratio,2)}×`;signal.append(badge(r.stage));if(r.laggard)signal.append(make('span','補漲觀察','laggard'));}
      else{score.textContent='—';rs.textContent='—';vol.textContent='—';signal.append(make('span',r.status==='stale'?'舊資料':'缺少資料','badge'));price.append(make('small',r.as_of||'未取得'));}
      const button=make('button','查看');button.type='button';button.setAttribute('aria-label',`查看${r.name}明細`);button.addEventListener('click',()=>showDetail(r));action.append(button);tr.append(name,price,score,rs,vol,signal,action);return tr;
    }));
    $('result-count').textContent=`${filtered.length} 檔 · ${state.market==='TW'?'TWD':'USD'}`;$('empty').hidden=filtered.length>0;
    $('sort-score').textContent=`動能分數 ${state.descending?'↓':'↑'}`;
    renderEvents();
  }
  function renderEvents(){
    const events=(state.data.events||[]).filter(e=>e.market===state.market);
    if(!events.length){const e=make('div',null,'event-empty');e.append(make('strong','目前沒有已核實、仍在追蹤期間內的催化事件'),make('p','量價雷達持續觀察。新增附來源的事件後，這裡會顯示第一波、第二波、第三波的關係與個股訊號。'));$('events').replaceChildren(e);return;}
    $('events').replaceChildren(...events.map(event=>{const card=make('article',null,'event');card.append(make('h3',event.title),make('p',`${event.date} · 第 ${event.trading_days} 個交易日`));
      for(const source of event.sources)card.append(safeLink(source.url,source.title||'公開來源'),make('span',' '));
      for(const wave of [1,2,3]){card.append(make('h4',`第 ${wave} 波`));const list=make('ul');for(const r of event.relationships.filter(x=>x.wave===wave)){const stock=state.data.stocks.find(s=>s.symbol===r.symbol);const li=make('li',`${stock?.name||r.symbol}｜${r.kind==='confirmed'?'已確認關係':'研究假設'}｜${r.description||''}｜${stock?.status==='ok'?labels[stock.stage]:'資料不足'}`);if(r.source)li.append(make('span',' '),safeLink(r.source,'關係來源'));list.append(li);}if(!list.children.length)list.append(make('li','尚無已整理的觀察公司'));card.append(list);}return card;}));
  }
  function showDetail(r){
    const box=$('detail-content');box.replaceChildren(make('p',`${r.symbol} · ${r.group_name}`,'eyebrow'),make('h2',r.name),make('p',`行情日期 ${r.as_of||'尚未取得'} · ${r.currency}`,'detail-note'));
    if(r.status!=='ok'){box.append(make('p',`未納入目前訊號：${r.error||'資料未更新'}`,'notice warn'));}
    else{box.append(badge(r.stage));const grid=make('div',null,'detail-grid');for(const [label,value]of [['動能分數',`${num(r.score)} / 100`],['20 日漲幅',pct(r.return_20d)],['5 日相對大盤',pct(r.rs_5d)],['20 日相對大盤',pct(r.rs_20d)],['成交量比',`${num(r.volume_ratio,2)}×`],['MA20 乖離',pct(r.ma20_distance)]]){const e=make('div');e.append(make('span',label),make('strong',value));grid.append(e);}box.append(grid);
      const list=make('ul');for(const reason of r.reasons)list.append(make('li',reason));box.append(list,make('h3','近 20 個交易日相對大盤走勢'),make('p','起點設為 0%，向上代表相對大盤轉強。','detail-note'));box.append(chart(r.series));
      box.append(make('h3','分數組成'),make('p',`相對強弱 ${num(r.components.relative_strength)} / 35 · 動能加速 ${num(r.components.acceleration)} / 20 · 均線 ${num(r.components.trend)} / 20 · 成交量 ${num(r.components.volume)} / 15 · 突破 ${num(r.components.breakout)} / 10`,'detail-note'));
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
    try{const response=await fetch(`rotation/data.json?t=${Date.now()}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();if(data.schema_version!==1||!Array.isArray(data.stocks)||!Array.isArray(data.groups)||!data.markets||!Number.isFinite(Date.parse(data.generated_at)))throw new Error('Invalid snapshot');state.data=data;
      $('updated').textContent=`雲端計算：${new Date(data.generated_at).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false})}（台北）`;render();
    }catch{ $('notice').className='notice warn';$('notice').textContent=state.data?'更新失敗，畫面保留上次成功讀取的資料；請留意行情日期。':'目前無法載入輪動資料。首次雲端更新尚未完成，或網路暫時無法連線，請稍後再試。';if(!state.data){$('updated').textContent='尚未取得雲端結果';$('events').replaceChildren(make('p','資料載入後顯示已核實的催化事件。','event-empty'));}}
    finally{button.disabled=false;button.textContent='重新讀取';}
  }
  document.querySelectorAll('[data-market]').forEach(b=>b.addEventListener('click',()=>{state.market=b.dataset.market;if(state.data)render();}));
  $('group').addEventListener('change',e=>{state.group=e.target.value;if(state.data)render();});$('stage').addEventListener('change',e=>{state.stage=e.target.value;if(state.data)render();});$('search').addEventListener('input',e=>{state.query=e.target.value;if(state.data)render();});$('sort-score').addEventListener('click',()=>{state.descending=!state.descending;if(state.data)render();});$('refresh').addEventListener('click',load);$('close-detail').addEventListener('click',()=>$('detail').close());
  load();
})();
