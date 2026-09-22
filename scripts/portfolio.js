/* Private holdings stay in the signed-in owner's Firestore collection. */
const $=id=>document.getElementById(id), L=window.PortfolioLogic, Journal=window.PortfolioActivity, Planning=window.PortfolioPlanning, Research=window.PortfolioResearch, Conviction=window.PortfolioConviction;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const num=(n,d=2)=>Number.isFinite(n)?(Object.is(n,-0)?0:n).toLocaleString('zh-TW',{maximumFractionDigits:Math.min(d,2)}):'—';
const qty=n=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:8}):'—';
const pct=n=>Number.isFinite(n)?`${n>0?'+':''}${num(n)}%`:'—';
let data,training,config,fundamentals,catalysts,researchCases,user=null,positions=[],preview=null,editing=null,unsubscribe=null,db,auth,F,A,loading=true;
let activityTarget=null,activityRows=[],activityUnsubscribe=null,activityLoading=false,activityBusy=false,activityId=null,previewActivity=[];
let convictionTarget=null,convictionRows=[],convictionBusy=false,convictionId=null,convictionOutcome=null,forwardPrices=null,previewConvictions=[];
const json=async path=>{const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw Error('讀取失敗');return r.json();};
const errorText=e=>e?.code==='permission-denied'?'Firebase 權限拒絕，未寫入。請確認登入的是自己的 Firebase 帳號。':e?.code?.startsWith('auth/')?'登入未完成，請核對 Email／密碼與網路；Firebase 控制台登入不等於網站帳號登入。':e?.message||'連線失敗，未儲存。';
const rows=()=>data?.stocks||[];
const quote=p=>rows().find(r=>r.symbol===p.symbol&&r.market===p.market);
function sync(message){$('sync-status').textContent=message;}
function updateAuth(){
  $('auth-state').textContent=user?`已登入 ${user.email||'目前帳號'}`:'未登入：先試算，登入後跨裝置同步。';
  $('login-form').hidden=!!user;$('logout').hidden=!user;
  $('save-position').disabled=!(user&&config?.cloud_enabled&&!loading);
}
function planningPanel(p,a,demo){
  const plan=Planning.build(p,quote(p),a,data,positions),box=node('section',undefined,'operation-plan');box.append(node('h4','這筆資金，接下來怎麼用？'));
  box.append(node('p','個股上漲勝率：尚無經驗證的估計。可展開下方研究，看不同持有期間的歷史結果與等待理由。','research-status'));
  const choices=node('div',undefined,'intent-choices');for(const [value,label]of [['hold','持續持有'],['rotate','考慮資金轉換']]){const b=node('button',label);b.type='button';b.setAttribute('aria-pressed',String(plan.intent===value));b.disabled=!demo&&(!user||loading);b.onclick=async()=>{b.disabled=true;try{if(demo){preview={...preview,capitalIntent:value};render();}else{await save({...p,capitalIntent:value},p.id,p.revision);sync('已更新這筆資金的用途偏好。');}}catch(e){sync(errorText(e));b.disabled=false;}};choices.append(b);}box.append(choices);
  if(plan.intent==='undecided')box.append(node('p','先選用途；系統不會因另一檔分數較高就自動建議換股。','plan-note'));
  const flow=node('ol',undefined,'strategy-flow');for(const [label,text]of [['現在',plan.action],['下一次檢查',plan.schedule],['之後',a.status==='exit'||a.status==='reduce'?'等風險解除，再評估新部位':'條件延續 → 續抱；條件失效 → 減碼／重查']]){const item=node('li');item.append(node('small',label),node('strong',text));flow.append(item);}box.append(flow,node('p',plan.horizonNote,'plan-note'));
  if(plan.intent==='rotate'){
    const compare=node('details');compare.open=true;compare.append(node('summary','續抱原股，還是比較其他股票？'),node('p',plan.rotationReason));
    if(!plan.candidates.length)compare.append(node('p','目前沒有資料完整、同市場、四項價量通過且未過熱的換股候選；先保留選擇，不勉強換股。'));
    else{const table=node('table',undefined,'rotation-comparison'),head=node('tr');for(const t of ['比較項目','原股',...plan.candidates.map(x=>x.name+' '+x.symbol+(x.held?'（已持有）':''))])head.append(node('th',t));const th=node('thead');th.append(head);const body=node('tbody');for(const values of [['價量條件',`${plan.currentPassed}/4`,...plan.candidates.map(x=>`${x.passed}/4`)],['動能分數',num(quote(p)?.score,1),...plan.candidates.map(x=>num(x.score,1))],['距月線',pct(quote(p)?.ma20_distance),...plan.candidates.map(x=>pct(x.maDistance))],['資金方向',moneyLabel(quote(p)?.smart_money?.bias),...plan.candidates.map(x=>moneyLabel(x.money))]]){const row=node('tr');values.forEach((v,i)=>row.append(node(i?'td':'th',v)));body.append(row);}table.append(th,body);const wrap=node('div',undefined,'comparison-scroll');wrap.append(table);compare.append(wrap,node('p','候選依現有動能分數排序；沒有估計換股後的淨報酬。台股資金欄為法人，美股為量價代理。','plan-note'));}
    box.append(compare);
  }
  box.append(researchPanel(p,a,plan));const judge=node('button','★ 看完材料，記錄我的判斷／檢查結果');judge.type='button';judge.disabled=!demo&&(!user||loading||!config?.conviction_enabled);judge.onclick=()=>openConviction(p,a,demo);box.append(judge,node('p',plan.limitation,'plan-note'));return box;
}
function researchLink(source){
  const a=node('a',source.title||'查看原始資料');
  try{const url=new URL(source.url);if(url.protocol!=='https:')return node('span','來源網址待檢查');a.href=url.href;}catch{return node('span','來源網址待補');}
  a.target='_blank';a.rel='noopener noreferrer';return a;
}
function researchPanel(p,a,plan){
  const detail=node('details',undefined,'research-detail');detail.append(node('summary','看詳細研究：勝率、基本面、等待多久'));
  const controls=node('div',undefined,'research-controls'),stockLabel=node('label','研究對象'),select=node('select');
  for(const s of [{symbol:p.symbol,name:p.name||p.symbol},...plan.candidates]){const o=node('option',s.name+' '+s.symbol);o.value=s.symbol;select.append(o);}stockLabel.append(select);
  const waitLabel=node('label','願意等待多久（情境比較）'),wait=node('select');for(const months of [1,2,3,6]){const o=node('option',months+' 個月');o.value=months;if(months===2)o.selected=true;wait.append(o);}waitLabel.append(wait);controls.append(stockLabel,waitLabel);
  const content=node('div');detail.append(controls,node('p','這裡的時間選擇只供比較，不會改動已儲存的持股期限。換股候選依「考慮資金轉換」的同市場條件產生。','plan-note'),content);
  function draw(){
    content.replaceChildren();const symbol=select.value,e=Research.evidence(symbol,fundamentals,catalysts,researchCases),record=e.record,row=rows().find(x=>x.symbol===symbol),h=Research.history(training,p.market,p.profile),months=Number(wait.value);
    content.append(node('h4',`${row?.name||symbol}：續抱與轉換的依據`),node('p',symbol===p.symbol?Research.scenario(a,plan.candidates.length>0):'以下為候選股票的公開資料，不套用原持股成本。候選仍需完成基本面與估值研究，尚不能認定換股更好。'));
    const list=(title,items)=>{content.append(node('h4',title));const ul=node('ul');for(const text of items)ul.append(node('li',text));content.append(ul);};
    const focus=Research.focus(record,row);list(focus.specific?'這家公司值得先查的問題':'研究起點（尚未完成公司專屬分析）',focus.questions);
    content.append(node('h4','基本面證據與公司時程'),node('p',record?.coverage||'尚未完成這檔的完整基本面研究；下列若有題材關係，仍需逐項確認。'));
    if(record)content.append(node('p',`人工資料核對日 ${record.checked_on}；各公告日期另列。${e.needsReview?'超過複查間隔，請重新核對。':''}`,'plan-note'));
    if(!fundamentals)content.append(node('p','基本面研究檔讀取失敗，無法確認證據完整度。','notice'));
    for(const fact of record?.facts||[]){const b=node('article',undefined,'evidence-card');b.append(node('strong',fact.title),node('p',fact.text),node('small','公告／資料日期 '+fact.date));if(fact.source)b.append(researchLink(fact.source));content.append(b);}
    const calculated=Research.financial(record);if(calculated.length){content.append(node('h4','財報交叉核對：可重算的指標'),node('p',`金額單位：${record.financial.unit}。下列百分比由原表計算，解讀屬研究推論。`,'plan-note'));for(const m of calculated){const b=node('article',undefined,'evidence-card');b.append(node('strong',`${m.label}：${num(m.value)}%`),node('p',m.formula,'plan-note'),node('p',m.meaning));content.append(b);}content.append(researchLink(record.financial.source));}
    if(record?.counter_views?.length)list('換一個角度：有哪些反向解釋？',record.counter_views);
    if(record?.transmission?.length){content.append(node('h4','上下游連動：逐段核對，不直接跳到個股結論'));const chain=node('ol',undefined,'strategy-flow');for(const step of record.transmission){const item=node('li');item.append(node('strong',`${step.from} → ${step.to}`),node('p',step.evidence),node('p','可能中斷：'+step.breaks,'plan-note'),node('p','下一個證據：'+step.check));chain.append(item);}content.append(chain);}
    const syncGroup=data?.synchrony?.find(g=>g.id===row?.group&&g.market===p.market);if(syncGroup){const fresh=row?.as_of===syncGroup.as_of&&window.RotationDecisions.dailyFresh(data,p.market);const group=node('article',undefined,'evidence-card');group.append(node('strong','異常同步：'+syncGroup.name),node('p',`${syncGroup.as_of} · 有效代表 ${syncGroup.available}/${syncGroup.total} 檔 · 向上 ${syncGroup.up_count} 檔／向下 ${syncGroup.down_count} 檔`),node('p',!fresh?'資料日期未對齊或已過期，暫停判讀。':syncGroup.status==='insufficient'?'族群代表不足，不把缺資料當成沒有異常。':`系統狀態：${({quiet:'尚未達異常同步門檻',up_anomaly:'異常向上同步',down_anomaly:'異常向下同步',up_sync:'向上同步（未達異常門檻）',down_sync:'向下同步（未達異常門檻）'})[syncGroup.status]||syncGroup.status}`),node('p',`資金確認 ${(syncGroup.money_confirmed||[]).join('、')||'尚無'}；分歧 ${(syncGroup.money_divergence||[]).join('、')||'尚無'}。`),node('p','同步只提供交叉線索，仍可能來自大盤、指數調整或同一新聞；不是內線證據，也尚未證明提高個股勝率。','plan-note'));content.append(group);}
    const events=record?.events||[];
    if(!events.length)content.append(node('p','可核對的催化時間尚未建立；不能把「基本面好」翻成再等 1～2 個月就會漲。','notice'));
    for(const event of events){const window=Research.waitWindow(event,months),b=node('article',undefined,'evidence-card');b.append(node('strong',event.title),node('p',event.status),node('p',event.text),node('p',`公司時程：${event.time_label}`),node('p',`你的等待範圍：從今天至 ${window.end}`),node('p',window.text,'notice'),node('small',`原公告 ${event.announced_on}；期間起訖僅用於情境比較。`));if(event.source)b.append(researchLink(event.source));content.append(b);}
    if(record?.transmission?.length){const stages=node('ol',undefined,'evidence-stages');for(const t of ['宣布／核准','建廠／裝機','驗收／投產','出貨／營收','獲利／現金流'])stages.append(node('li',t));content.append(stages,node('p','每一步要不同證據。官方「計畫」不能當成已投產，投產也不等於股價尚未反映。','plan-note'));}
    list('接下來查什麼',record?.next_checks||['核對公司財報、正式訂單或擴產公告及實際完成時間。','核對營收、毛利、現金流和估值是否支持持有理由。','以完整收盤價量確認，並觀察法人／資金是否同向。']);
    list('什麼情況就不值得繼續等',record?.invalidations||['需求、訂單或交付時程不如原假設。','成長沒有轉成獲利／現金流，或估值已過度反映。','觸及你的風險線，或資金使用期限已改變。']);
    for(const event of e.related){const b=node('article',undefined,'evidence-card');b.append(node('strong',event.title),node('p',`${event.date} · ${event.kind==='confirmed'?'已確認關係（不等於新增訂單）':'產業延伸假設'}`),node('p',event.description),node('p',event.boundary,'plan-note'));for(const s of event.sources)b.append(researchLink(s));content.append(b);}
    for(const c of e.hypotheses){const b=node('article',undefined,'evidence-card');b.append(node('strong',`${c.wave?'第 '+c.wave+' 波':'另一路'} · ${c.role}（研究假設）`),node('p',c.view),node('p',`${c.date} · ${c.note}`,'plan-note'));content.append(b);}
    content.append(node('h4','歷史勝率：原策略，不是這檔的預測'),node('p',h.note));
    if(h.rows.length){
      content.append(node('p',`${p.market==='TW'?'台股':'美股'}原 ${h.count} 檔名單 · 固定歷史驗證 ${h.start}～${h.end} · 報告產生 ${h.generatedAt?.slice(0,10)||'未提供'}。`,'plan-note'));
      if(h.failed)content.append(node('p','更新失敗：保留上次報告與原日期，不能當作新驗證。','notice'));
      const table=node('table',undefined,'rotation-comparison'),thead=node('thead'),tr=node('tr');for(const text of ['最長交易日','歷史勝率','筆數／期末結算','累積報酬','最大回落','成本加倍報酬'])tr.append(node('th',text));thead.append(tr);const body=node('tbody');
      for(const r of h.rows){const tr=node('tr');for(const text of [r.days+' 日',r.winRate===null?'無有效樣本':num(r.winRate)+'%',`${r.trades}／${r.forced}`,pct(r.returnPct),pct(r.drawdown),pct(r.doubleCost)])tr.append(node('td',text));body.append(tr);}table.append(thead,body);const wrap=node('div',undefined,'comparison-scroll');wrap.append(table);content.append(wrap);
      list('怎麼讀這張表',['勝率＝扣除模型交易成本後獲利的交易筆數 ÷ 所有已結束交易，含期末強制結算；交易可能互相關聯。','最長持有期不是一定抱滿；跌破策略月線可提前退出。20 個交易日約一個月，60 日約三個月；目前沒有 40 日／兩個月組，不能自行插值。','累積報酬與回落是整體策略資金曲線，並非單筆預期收益。只看勝率會忽略賺小賠大的可能。','名單有事後選股偏差；未加入個人成本、擴廠、估值、長期續抱或換股條件。不能挑表中最高勝率當作這檔最佳持有天數。',`獨立前瞻自 ${h.forwardStart||'未設定'} 起另看；目前不足以校準這檔的未來機率。`]);
    }
    if(p.thesis&&symbol===p.symbol)list('你記錄的持有理由（未由系統驗證）',[p.thesis]);
  }
  select.onchange=draw;wait.onchange=draw;draw();return detail;
}
function moneyLabel(bias){return {buying:'偏買',selling:'偏賣',mixed:'分歧',neutral:'中性'}[bias]||'未齊';}
function closeConviction(){convictionTarget=null;convictionRows=[];convictionOutcome=null;$('conviction-dialog').close();}
function convictionInput(){return Object.fromEntries(new FormData($('conviction-form')));}
function updateConvictionAdvice(){if(!convictionTarget)return;const v=convictionInput(),t=Conviction.target(Number(v.months));$('conviction-advice').textContent=`${Conviction.advice(Number(v.stars),convictionTarget.assessment)} 驗證月份：${t.month}；等該期間公告後再填結果。`;$('save-conviction').disabled=convictionBusy||(!convictionTarget.demo&&(!user||loading||!config?.conviction_enabled));}
async function loadConvictions(){
  const target=convictionTarget;if(!target)return;
  if(target.demo)convictionRows=[...previewConvictions];
  else{const uid=user?.uid,base=F.collection(db,'rotationPortfolios',uid,'positions',target.position.id,'convictions');const snap=await F.getDocsFromServer(F.query(base,F.orderBy('createdAt','desc')));const rows=await Promise.all(snap.docs.map(async d=>{const results=await F.getDocsFromServer(F.query(F.collection(d.ref,'outcomes'),F.orderBy('createdAt','desc'),F.limit(1)));return {...d.data(),id:d.id,outcome:results.empty?null:results.docs[0].data()};}));if(user?.uid!==uid||convictionTarget!==target)return;convictionRows=rows;}
  renderConvictions();
}
async function openConviction(p,a,demo){
  convictionTarget={position:p,assessment:a,demo};convictionId=crypto.randomUUID();convictionOutcome=null;convictionRows=[];$('conviction-form').reset();$('outcome-editor').hidden=true;$('conviction-error').textContent='';$('conviction-title').textContent=`${p.name||p.symbol}｜我的判斷與驗證`;$('conviction-context').textContent=demo?'試算資料只留在本頁；重整後清除。':'私人紀錄存於本人 Firebase 路徑；重新評星會新增版本。';$('conviction-dialog').showModal();updateConvictionAdvice();
  try{forwardPrices=await json('rotation/forward_prices.json');}catch{forwardPrices=null;}
  try{await loadConvictions();}catch(e){$('conviction-error').textContent=errorText(e);}
}
function renderConvictions(){
  if(!convictionTarget)return;const table=node('table',undefined,'rotation-comparison'),head=node('tr');for(const text of ['星等','原始樣本','論點實現／已驗證','股價獲利／到期樣本'])head.append(node('th',text));table.append(head);
  for(const s of Conviction.summarize(convictionRows,forwardPrices)){const r=node('tr');for(const text of ['★'.repeat(s.stars),s.forecasts,s.revenueSamples?`${s.revenueHits}／${s.revenueSamples}`:'待驗證',s.priceSamples?`${s.priceWins}／${s.priceSamples}`:'尚未到期／資料未齊'])r.append(node('td',text));table.append(r);}$('conviction-stats').replaceChildren(table);
  const list=$('conviction-history');list.replaceChildren();if(!convictionRows.length)list.append(node('p','尚無紀錄。先閱讀材料、寫下可驗證的論點，再開始累積。'));
  for(const f of convictionRows){const b=node('article',undefined,'evidence-card'),created=Conviction.timestamp(f.createdAt),result=Conviction.forward(f,forwardPrices);b.append(node('strong',`${'★'.repeat(f.stars)} · 驗證 ${f.targetMonth}`),node('p',`記錄 ${Number.isFinite(created)?new Date(created).toLocaleString('zh-TW'):'同步中'} · ${f.comparison==='yoy'?'月營收年增':f.comparison==='mom'?'月營收月增':'自訂論點'}`,'plan-note'),node('p','我的依據：'+f.thesis),node('p','實現條件：'+f.criterion),node('p','改變想法的證據：'+f.invalidates),node('p','當時操作參考：'+f.action));
    if(f.outcome){try{const outcome=Conviction.revenue(f.outcome);b.append(node('p',`論點驗證（人工登錄）：${outcome.hit?'已實現':'未實現'}${outcome.growthPct===null?'':' · 營收增幅 '+pct(outcome.growthPct)}`),node('p',f.outcome.note),researchLink({title:'你提供的驗證來源（尚未自動核實）',url:f.outcome.sourceUrl}));}catch{b.append(node('p','驗證紀錄格式不足，暫不計入。'));}}
    else b.append(node('p','論點驗證：等待期滿後的正式資料。'));
    b.append(node('p',result.note));if(result.status==='complete')b.append(node('p',`${result.entry} → ${result.exit} · 扣模型成本報酬 ${pct(result.returnPct)} · 成本加倍 ${pct(result.doubleCost)} · 收盤最大回落 ${pct(result.drawdown)}`));
    const outcome=node('button',f.outcome?'補充／更正驗證（保留歷史）':'填入公告驗證');outcome.type='button';outcome.disabled=convictionBusy||Date.now()<Conviction.timestamp(f.targetAfter);outcome.onclick=()=>{convictionOutcome=f;$('outcome-form').reset();$('outcome-editor').hidden=false;$('outcome-title').textContent=`驗證 ${f.targetMonth} · ${f.criterion}`;$('revenue-fields').hidden=f.comparison==='custom';$('custom-outcome').hidden=f.comparison!=='custom';for(const field of ['actualRevenue','baselineRevenue'])$('outcome-form').elements[field].required=f.comparison!=='custom';$('outcome-editor').scrollIntoView({behavior:'smooth'});};b.append(outcome);list.append(b);
  }
}
$('conviction-form').oninput=updateConvictionAdvice;
$('conviction-form').onsubmit=async e=>{e.preventDefault();if(convictionBusy||!convictionTarget)return;const target=convictionTarget,id=convictionId;try{convictionBusy=true;updateConvictionAdvice();const f=Conviction.make(convictionInput(),target.position,target.assessment);if(target.demo)previewConvictions.unshift({...f,id,createdAt:new Date().toISOString()});else{const uid=user.uid,ref=F.doc(db,'rotationPortfolios',uid,'positions',target.position.id,'convictions',id);await F.runTransaction(db,async tx=>{const old=await tx.get(ref);if(auth.currentUser?.uid!==uid)throw Error('登入帳號已變更。');if(!old.exists())tx.set(ref,{...f,targetAfter:F.Timestamp.fromDate(new Date(f.targetAfter)),createdAt:F.serverTimestamp()});});}if(convictionTarget!==target)return;convictionId=crypto.randomUUID();$('conviction-error').textContent=target.demo?'已加入試算，未寫入雲端。':'已保存原始判斷，等待後續驗證。';await loadConvictions();}catch(e){$('conviction-error').textContent=errorText(e);}finally{convictionBusy=false;updateConvictionAdvice();}};
$('outcome-form').onsubmit=async e=>{e.preventDefault();if(convictionBusy||!convictionOutcome)return;const f=convictionOutcome,v=Object.fromEntries(new FormData($('outcome-form'))),o={kind:f.comparison,actualRevenue:f.comparison==='custom'?0:Number(v.actualRevenue),baselineRevenue:f.comparison==='custom'?1:Number(v.baselineRevenue),hit:v.hit==='true',sourceUrl:v.sourceUrl.trim(),note:v.note.trim()};try{if(Date.now()<Conviction.timestamp(f.targetAfter))throw Error('驗證期間尚未結束。');Conviction.revenue(o);if(!o.note||o.note.length>500||o.sourceUrl.length>1000)throw Error('請填完整驗證理由及來源。');convictionBusy=true;if(convictionTarget.demo){previewConvictions.find(x=>x.id===f.id).outcome={...o,createdAt:new Date().toISOString()};}else{const uid=user.uid,ref=F.doc(F.collection(db,'rotationPortfolios',uid,'positions',convictionTarget.position.id,'convictions',f.id,'outcomes'));await F.setDoc(ref,{...o,createdAt:F.serverTimestamp()});}await loadConvictions();$('outcome-editor').hidden=true;$('conviction-error').textContent='已新增驗證；營運判斷與股價結果分開記錄。';}catch(e){$('conviction-error').textContent=errorText(e);}finally{convictionBusy=false;updateConvictionAdvice();}};
$('close-conviction').onclick=()=>{if(!convictionBusy)closeConviction();};$('conviction-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!convictionBusy)closeConviction();});
function card(p,demo=false){
  let a;try{a=L.assess(p,quote(p),data);}catch{a={status:'unknown',title:'計畫資料需要檢查',reason:'欄位格式不完整，請編輯後重新保存。',checks:[],alternatives:[]};}
  const c=node('article',undefined,`position-card${demo?' position-demo':''}`);
  if(demo)c.append(node('p','試算預覽 · 尚未儲存','eyebrow'));
  const h=node('header'),title=node('div');title.append(node('h3',p.name||p.symbol),node('span',`${p.symbol} · ${p.market==='TW'?'TWD':'USD'} · ${L.profiles[p.profile]}`));h.append(title);c.append(h);
  c.append(node('p',`${p.durationValue} ${L.units[p.durationUnit]}計畫 · ${p.planStart} → ${a.expiry||'待確認'}`,'plan-note'));
  c.append(node('strong',p.archived?'已移出觀察':a.title,`position-status ${a.status}`),node('p',a.reason));
  const comparison=node('div',undefined,'cost-comparison');for(const [label,value]of [['你的平均成本',num(p.cost)],['最新完整收盤',num(a.price)]]){const cell=node('div');cell.append(node('small',label),node('strong',value));comparison.append(cell);}c.append(comparison);
  const k=node('div',undefined,'position-kpis');for(const [label,value] of [['未實現損益',`${num(a.pnl)} ${p.market==='TW'?'TWD':'USD'}`],['與成本相比',pct(a.pnlPct)],['自訂成本風險線',num(a.lossLine)]]){const cell=node('div');cell.append(node('small',label),node('strong',value));k.append(cell);}c.append(k);
  c.append(node('p',`目前 ${qty(p.quantity)} 股${a.asOf?' · 收盤日期 '+a.asOf:''} · 成本已含登錄的加碼費用`,'plan-note'));
  c.append(planningPanel(p,a,demo));
  const signal=node('section',undefined,'next-signal');signal.append(node('h4',a.nextHeading||'下一個訊號'));const bullets=node('ul');for(const text of a.nextItems||[a.next||'先等完整且同日的行情與指標補齊；資料缺漏不代表安全。'])bullets.append(node('li',text));signal.append(bullets);if(a.nextNote)signal.append(node('p',a.nextNote,'plan-note'));c.append(signal);
  const choices=node('div',undefined,'plan-choices');for(const x of a.alternatives){const box=node('div');box.append(node('strong',x.title),node('p',x.text));choices.append(box);}c.append(choices);
  const detail=node('details');detail.append(node('summary','本次收盤條件與持有理由'));const checks=node('ul');
  for(const check of a.checks)checks.append(node('li',`${check.passed?'✓':'待確認'} ${check.label}${Number.isFinite(check.actual)?'（目前 '+num(check.actual)+'）':''}`));detail.append(checks,node('p',p.thesis||'尚未填寫持有理由。'),node('p','條件更完整，僅代表證據增加；這組持股規則尚未回測，沒有可宣稱的勝率。','plan-note'));c.append(detail);
  c.append(node('p',`調整紀錄 ${p.activityCount||0} 筆 · 追蹤後已實現損益 ${num(p.realizedPnl||0)} ${p.market==='TW'?'TWD':'USD'}`,'plan-note'));
  const actions=node('div',undefined,'form-actions');
  for(const [label,kind] of [['＋ 加碼','buy'],['－ 減碼','sell'],['查看加減碼紀錄','history']]){const b=node('button',label);b.disabled=(!demo&&(!user||loading||!config?.activity_enabled))||(kind!=='history'&&p.archived)||(kind==='sell'&&p.quantity===0);b.onclick=()=>openActivity(p,demo,kind);actions.append(b);}
  const edit=node('button','編輯計畫');edit.onclick=()=>openForm(p,demo);actions.append(edit);
  const archive=node('button',demo?'移除預覽':p.archived?'恢復觀察':'移出觀察');archive.disabled=!demo&&(!user||loading);archive.onclick=async()=>{if(demo){preview=null;render();return;}archive.disabled=true;try{await save({...p,archived:!p.archived},p.id,p.revision);sync('已同步，移出的持股可隨時恢復。');}catch(e){sync(errorText(e));archive.disabled=false;}};actions.append(archive);c.insertBefore(actions,c.querySelector('.operation-plan'));return c;
}
function render(){
  const root=$('positions');root.replaceChildren();const visible=positions.filter(p=>!p.archived||$('show-archived').checked);if(preview)root.append(card(preview,true));for(const p of visible)root.append(card(p));
  if(activityTarget)renderActivity();
  if(!visible.length&&!preview)root.append(node('div',loading&&user?'正在讀取持股…':'還沒有持股計畫。新增一檔，先比較續抱、減碼與退出條件。','portfolio-empty'));
  const totals=$('portfolio-summary');totals.replaceChildren();for(const market of ['TW','US']){const list=positions.filter(p=>!p.archived&&p.market===market);if(!list.length)continue;const results=list.map(p=>{try{return L.assess(p,quote(p),data);}catch{return {};}});const known=results.filter(x=>Number.isFinite(x.value));const box=node('div');box.append(node('small',`${market==='TW'?'TWD':'USD'} · ${known.length}/${list.length} 檔可估值`),node('strong',num(known.reduce((s,x)=>s+x.value,0))),node('span',`未實現損益 ${num(known.reduce((s,x)=>s+x.pnl,0))}${known.length<list.length?' · 缺資料部分未計入':''}`));totals.append(box);}
}
function openForm(p=null,demo=false){editing=p?{id:p.id,revision:p.revision,demo}:null;const form=$('position-form');form.reset();form.elements.planStart.value=L.day();if(p)for(const e of form.elements)if(e.name&&p[e.name]!==undefined)e.value=p[e.name];const locked=!!p?.activityCount;for(const name of ['symbol','market','cost','quantity'])form.elements[name].disabled=locked;$('position-ledger-note').hidden=!locked;$('form-error').textContent='';$('position-title').textContent=editing?'編輯持股計畫':'新增／試算持股';$('preview-position').disabled=!!editing&&!editing.demo;updateAuth();$('position-dialog').showModal();}
function fromForm(){const raw=Object.fromEntries(new FormData($('position-form'))),old=editing?(editing.demo?preview:positions.find(p=>p.id===editing.id)):null;if(old?.activityCount)for(const key of ['symbol','market','cost','quantity'])raw[key]=old[key];raw.name=rows().find(r=>r.symbol===raw.symbol.trim().toUpperCase())?.name||old?.name||raw.symbol;raw.archived=!!old?.archived;const clean=L.normalize(raw,{allowClosed:old?.schemaVersion===2});return old?.activityCount?{...old,...clean,schemaVersion:2}:clean;}
async function save(p,id,revision=0){
  if(!user||!config?.cloud_enabled||loading)throw Error('尚未完成登入及雲端同步，未儲存。');
  const uid=user.uid,ref=F.doc(db,'rotationPortfolios',uid,'positions',id||crypto.randomUUID());
  await F.runTransaction(db,async tx=>{const current=await tx.get(ref),old=current.exists()?current.data():null;if((old?.revision||0)!==revision)throw Error('另一個裝置已更新這筆計畫，請關閉表單後重新編輯。');if(auth.currentUser?.uid!==uid)throw Error('登入帳號已改變，請重新操作。');const clean=L.normalize(p,{allowClosed:old?.schemaVersion===2});if(old?.activityCount&&['symbol','market','cost','quantity'].some(k=>clean[k]!==old[k]))throw Error('已有調整紀錄，請透過加碼／減碼更新股數與成本。');tx.set(ref,{...old,...clean,schemaVersion:old?.schemaVersion||1,revision:revision+1,updatedAt:F.serverTimestamp()});});
}
$('new-position').onclick=()=>openForm();$('close-position').onclick=()=>$('position-dialog').close();$('show-archived').onchange=render;
$('preview-position').onclick=()=>{try{const keep=editing?.demo;preview=fromForm();if(!keep){previewActivity=[];previewConvictions=[];}$('position-dialog').close();render();$('positions').scrollIntoView({behavior:'smooth'});}catch(e){$('form-error').textContent=errorText(e);}};
$('position-form').onsubmit=async e=>{e.preventDefault();const button=$('save-position');button.disabled=true;try{if(editing?.demo&&preview?.activityCount)throw Error('試算已有模擬調整，請另建實際持股起點後再登錄成交紀錄。');await save(fromForm(),editing?.demo?undefined:editing?.id,editing?.demo?0:editing?.revision||0);preview=null;previewActivity=[];$('position-dialog').close();sync('已安全儲存到 Firebase；其他裝置登入同帳號即可同步。');render();}catch(e){$('form-error').textContent=errorText(e);}finally{updateAuth();}};
function weights(w){const box=node('div',undefined,'weight-bars');['相對強弱','加速度','趨勢','成交量','突破'].forEach((label,i)=>{const r=node('div',undefined,'weight-line'),track=node('div',undefined,'weight-track'),bar=node('span');bar.style.width=`${w[i]}%`;track.append(bar);r.append(node('span',label),track,node('span',`${w[i]}%`));box.append(r);});return box;}
const selectedPosition=()=>activityTarget?.demo?preview:positions.find(p=>p.id===activityTarget?.id);
const latestActivity=()=>{const p=selectedPosition();return activityRows.find(r=>r.id===p?.lastActivityId)||null;};
function closeActivity(){activityUnsubscribe?.();activityUnsubscribe=null;activityTarget=null;activityRows=[];$('activity-dialog').close();}
function activityInput(){return Object.fromEntries(new FormData($('activity-form')));}
function activityReady(){const p=selectedPosition();return !!p&&!activityBusy&&!activityLoading&&!p.archived&&(!p.activityCount||!!latestActivity())&&(activityTarget.demo||user&&!loading&&config?.activity_enabled);}
function updateActivityPreview(){
  const p=selectedPosition();if(!p)return;const input=activityInput();
  $('confirm-undo').disabled=!activityReady();
  $('save-activity').disabled=!activityReady();$('undo-activity').disabled=!activityReady()||!latestActivity()||latestActivity().kind==='reverse';
  if(!input.quantity||!input.price){$('activity-preview').textContent='填寫成交股數與單價，就能先看調整後股數、平均成本與本次已實現損益。';return;}
  try{const next=Journal.apply(p,input,latestActivity(),activityId,L.day());$('activity-preview').textContent=`${qty(p.quantity)} → ${qty(next.position.quantity)} 股 · 平均成本 ${num(p.cost)} → ${num(next.position.cost)} · 本次已實現損益 ${num(next.entry.realizedPnl)} ${p.market==='TW'?'TWD':'USD'}`;}catch(e){$('activity-preview').textContent=errorText(e);$('save-activity').disabled=true;}
}
function renderActivity(){
  const p=selectedPosition();if(!p){closeActivity();return;}
  $('activity-title').textContent=`${p.name||p.symbol}｜加減碼紀錄`;
  $('activity-context').textContent=`${activityTarget.demo?'試算，不會儲存 · ':''}${p.symbol} · 目前 ${qty(p.quantity)} 股 · 平均成本 ${num(p.cost)} · 累計已實現損益 ${num(p.realizedPnl||0)} ${p.market==='TW'?'TWD':'USD'}`;
  const list=$('activity-history');list.replaceChildren();
  if(activityLoading)list.append(node('p','正在同步調整紀錄…'));
  else if(!activityRows.length)list.append(node('p','尚無加減碼紀錄。第一次登錄將以目前股數與成本作為追蹤起點。'));
  const reversed=new Set(activityRows.filter(r=>r.kind==='reverse').map(r=>r.reversesId));
  for(const r of activityRows){const item=node('article',undefined,`activity-entry ${r.kind}`),label=r.kind==='buy'?'加碼':r.kind==='sell'?'減碼':'撤回登錄';item.append(node('strong',`${r.date} · ${label}${reversed.has(r.id)?'（已撤回）':''}`),node('p',`${qty(r.quantity)} 股 × ${num(r.price)} · 費用 ${num(r.fees)}`),node('p',`股數 ${qty(r.beforeQuantity)} → ${qty(r.afterQuantity)} · 均價 ${num(r.beforeCost)} → ${num(r.afterCost)}`),node('p',`本次已實現損益 ${num(r.realizedPnl)} ${p.market==='TW'?'TWD':'USD'}`));if(r.note)item.append(node('p',r.note,'plan-note'));list.append(item);}
  updateActivityPreview();
}
function openActivity(p,demo,kind){
  activityUnsubscribe?.();activityUnsubscribe=null;activityTarget={id:p.id,demo};activityRows=demo?[...previewActivity].reverse():[];activityLoading=!demo;activityId=crypto.randomUUID();
  const form=$('activity-form');form.reset();form.elements.date.value=L.day();form.elements.date.max=L.day();form.elements.kind.value=kind==='sell'?'sell':'buy';$('activity-error').textContent='';$('undo-confirmation').hidden=true;$('activity-dialog').showModal();renderActivity();
  if(demo)return;
  const uid=user.uid,positionId=p.id;
  activityUnsubscribe=F.onSnapshot(F.query(F.collection(db,'rotationPortfolios',uid,'positions',positionId,'activity'),F.orderBy('revision','desc')),{includeMetadataChanges:true},snap=>{if(user?.uid!==uid||activityTarget?.id!==positionId)return;activityLoading=snap.metadata.fromCache;activityRows=snap.docs.map(d=>({...d.data(),id:d.id}));renderActivity();},e=>{activityLoading=true;$('activity-error').textContent=errorText(e);updateActivityPreview();});
}
async function writeActivity(input){
  if(!activityReady())throw Error('持股或最後一筆紀錄尚未同步，請稍後重試。');
  const p=selectedPosition(),target={...activityTarget},id=activityId,revision=p.revision||0;
  activityBusy=true;updateActivityPreview();
  try{
    if(target.demo){const result=Journal.apply(p,input,latestActivity(),id,L.day());preview=result.position;previewActivity.push({...result.entry,id});activityRows=[...previewActivity].reverse();}
    else{
      const uid=user.uid,parent=F.doc(db,'rotationPortfolios',uid,'positions',target.id),event=F.doc(F.collection(parent,'activity'),id);
      await F.runTransaction(db,async tx=>{
        const current=await tx.get(parent),existing=await tx.get(event);if(auth.currentUser?.uid!==uid)throw Error('登入帳號已改變，未儲存。');if(existing.exists())return;
        if(!current.exists()||current.data().revision!==revision)throw Error('另一個裝置已更新持股，請核對新股數後重新送出。');
        const before=current.data();let last=null;if(before.lastActivityId){const s=await tx.get(F.doc(F.collection(parent,'activity'),before.lastActivityId));if(s.exists())last={...s.data(),id:s.id};}
        const result=Journal.apply(before,input,last,id,L.day());
        tx.set(event,{...result.entry,createdAt:F.serverTimestamp()});tx.set(parent,{...result.position,updatedAt:F.serverTimestamp()});
      });
    }
    activityId=crypto.randomUUID();const form=$('activity-form');form.elements.quantity.value='';form.elements.price.value='';form.elements.fees.value='0';form.elements.note.value='';$('activity-error').textContent=target.demo?'已加入試算歷程，未寫入雲端。':'已儲存紀錄並同步更新持股。';render();
  }finally{activityBusy=false;if(activityTarget)updateActivityPreview();}
}
$('activity-form').oninput=updateActivityPreview;
$('activity-form').onsubmit=async e=>{e.preventDefault();try{await writeActivity(activityInput());}catch(error){$('activity-error').textContent=errorText(error);}};
$('undo-activity').onclick=()=>{$('undo-confirmation').hidden=false;};
$('cancel-undo').onclick=()=>{$('undo-confirmation').hidden=true;};
$('confirm-undo').onclick=async()=>{try{await writeActivity({kind:'reverse'});$('undo-confirmation').hidden=true;}catch(error){$('activity-error').textContent=errorText(error);}};
$('close-activity').onclick=()=>{if(!activityBusy)closeActivity();};
$('activity-dialog').addEventListener('cancel',e=>{e.preventDefault();if(!activityBusy)closeActivity();});
function renderTraining(){
  if(!training)return;const root=$('training-result');root.replaceChildren();const m=training.markets.find(m=>m.market===$('train-market').value),r=m?.results.find(r=>r.profile===$('train-profile').value&&r.holding_days===Number($('train-horizon').value));if(!r){root.append(node('p','這個組合資料不足。'));return;}
  const labels={no_improvement:'尚未勝過基準，保留原權重',insufficient:'樣本不足，保留原權重',tradeoff:'報酬與回落有取捨，保留原權重',forward_only:'歷史較佳，仍需新資料驗證；尚未套用'};
  root.append(node('h3',labels[r.assessment]),node('p',`訓練 ${m.train_start}～${m.train_end}；歷史驗證 ${m.validation_start}～${m.validation_end}。`));
  if(training.status!=='ok'||training.refresh_status==='failed')root.append(node('p','最近更新未完成；以下保留上次結果與實際日期。','notice'));
  const comparison=node('div',undefined,'training-comparison');for(const [title,metric,w] of [['原權重排序基準',r.baseline,training.config.baseline],['訓練期選出的候選',r.candidate,r.weights]]){const a=node('article');a.append(node('h3',title),weights(w));const stats=node('div',undefined,'training-metrics');for(const [label,value] of [['驗證累積報酬',pct(metric.return_pct)],['最大回落',pct(metric.max_drawdown_pct)],['交易筆數',`${metric.trades}（期末結算 ${metric.forced_exits}）`],['歷史交易勝率',pct(metric.win_rate_pct)]]){const s=node('div');s.append(node('small',label),node('strong',value));stats.append(s);}a.append(stats);comparison.append(a);}root.append(comparison);
  root.append(node('p',`候選成本加倍後報酬 ${pct(r.double_cost.return_pct)}${r.baseline_double_cost?'；基準成本加倍 '+pct(r.baseline_double_cost.return_pct):''}。勝率包含期末結算，交易之間可能相關，不能當成你下一筆的勝率。`));
  root.append(node('p',`新前瞻期間自 ${training.forward_start} 起，固定權重後另行觀察。${r.forward?'候選累積報酬 '+pct(r.forward.return_pct)+'，'+r.forward.trades+' 筆（含期末結算 '+r.forward.forced_exits+'）；樣本仍需累積。':r.forward_status==='missing_data'?'新前瞻期間行情有缺漏，暫停評估；不影響已固定的歷史區間。':'尚無足夠的新前瞻資料。'}`,'notice'));
  const detail=node('details');detail.append(node('summary','訓練方法、偏好與限制'));detail.append(node('p',`11 組固定候選，三段訓練期的「年化報酬－回落懲罰」中位數選擇。保守／平衡／積極的回落懲罰分別是 1.5／0.75／0.25；只調整同時符合量價條件時的排序，不是資金配置比例。這裡的排序基準與舊頁 RS20 排序回測不同，不能直接混比。`));const ul=node('ul');for(const note of training.limitations)ul.append(node('li',note));detail.append(ul);root.append(detail);
}
for(const id of ['train-market','train-profile','train-horizon'])$(id).onchange=renderTraining;
const loaded=await Promise.allSettled([json('rotation/data.json'),json('rotation/weight_training.json'),json('rotation/portfolio_config.json'),json('rotation/fundamental_research.json'),json('rotation/catalysts.json'),json('rotation/research_cases.json')]);
if(loaded[0].status==='fulfilled'){data=loaded[0].value;$('quote-status').textContent=`完整日線：台股 ${data.markets.TW.as_of}／美股 ${data.markets.US.as_of}。每筆計畫另檢查時效；盤中價格不冒充收盤訊號。`;for(const r of rows()){const opt=node('option',r.name);opt.value=r.symbol;$('symbols').append(opt);}}else $('quote-status').textContent='公開行情讀取失敗，暫不產生持股判斷。';
if(loaded[1].status==='fulfilled'){training=loaded[1].value;renderTraining();}else $('training-result').textContent='訓練結果暫時無法讀取。';
if(loaded[2].status==='fulfilled')config=loaded[2].value;
if(loaded[3].status==='fulfilled')fundamentals=loaded[3].value;
if(loaded[4].status==='fulfilled')catalysts=loaded[4].value;
if(loaded[5].status==='fulfilled')researchCases=loaded[5].value;
render();
try{
  const App=await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
  [A,F]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')]);
  const app=App.getApps().length?App.getApp():App.initializeApp({apiKey:'AIzaSyCnHhksuhJs9RdrL7DPnsAvR21ZND7kIOI',authDomain:'stack-diagram-db.firebaseapp.com',projectId:'stack-diagram-db',storageBucket:'stack-diagram-db.firebasestorage.app',messagingSenderId:'67240747982',appId:'1:67240747982:web:1fb065e40e936a7485419f'});
  auth=A.getAuth(app);db=F.getFirestore(app);
  A.onAuthStateChanged(auth,current=>{unsubscribe?.();unsubscribe=null;closeActivity();closeConviction();previewConvictions=[];user=current;positions=[];preview=null;previewActivity=[];editing=null;$('position-dialog').close();loading=!!current;updateAuth();render();
    if(!current){loading=false;sync('未登入。你可以先用試算預覽，不會儲存。');return;}
    if(!config?.cloud_enabled){loading=true;sync('雲端持股規則尚未完成確認，暫停讀寫；仍可先試算。');return;}
    const uid=current.uid;unsubscribe=F.onSnapshot(F.collection(db,'rotationPortfolios',uid,'positions'),{includeMetadataChanges:true},snap=>{if(user?.uid!==uid)return;loading=snap.metadata.fromCache;positions=snap.docs.map(d=>({...d.data(),id:d.id}));sync(loading?'正在等待伺服器確認；暫停修改。':`已與 Firebase 同步 ${positions.length} 筆持股計畫。`);updateAuth();render();},e=>{if(user?.uid!==uid)return;loading=true;positions=[];sync(errorText(e));updateAuth();render();});
  });
  $('login-form').onsubmit=async e=>{e.preventDefault();const password=$('login-password').value;$('login-password').value='';try{await A.signInWithEmailAndPassword(auth,$('login-email').value.trim(),password);}catch(e){sync(errorText(e));}};
  $('logout').onclick=async()=>{try{await A.signOut(auth);}catch(e){sync(errorText(e));}};
}catch{loading=false;updateAuth();sync('Firebase 無法連線；試算仍可使用，沒有儲存任何持股。');$('login-form').hidden=true;}
