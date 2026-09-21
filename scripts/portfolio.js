/* Private holdings stay in the signed-in owner's Firestore collection. */
const $=id=>document.getElementById(id), L=window.PortfolioLogic;
const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const num=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('zh-TW',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const pct=n=>Number.isFinite(n)?`${n>0?'+':''}${num(n)}%`:'—';
let data,training,config,user=null,positions=[],preview=null,editing=null,unsubscribe=null,db,auth,F,A,loading=true;
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
function card(p,demo=false){
  let a;try{a=L.assess(p,quote(p),data);}catch{a={status:'unknown',title:'計畫資料需要檢查',reason:'欄位格式不完整，請編輯後重新保存。',checks:[],alternatives:[]};}
  const c=node('article',undefined,`position-card${demo?' position-demo':''}`);
  if(demo)c.append(node('p','試算預覽 · 尚未儲存','eyebrow'));
  const h=node('header'),title=node('div');title.append(node('h3',p.name||p.symbol),node('span',`${p.symbol} · ${p.market==='TW'?'TWD':'USD'} · ${L.profiles[p.profile]}`));h.append(title);c.append(h);
  c.append(node('p',`${p.durationValue} ${L.units[p.durationUnit]}計畫 · ${p.planStart} → ${a.expiry||'待確認'}`,'plan-note'));
  c.append(node('strong',p.archived?'已移出觀察':a.title,`position-status ${a.status}`),node('p',a.reason));
  const k=node('div',undefined,'position-kpis');
  for(const [label,value] of [['完整收盤',num(a.price)],['成本損益',pct(a.pnlPct)],['自訂成本風險線',num(a.lossLine)]]){const cell=node('div');cell.append(node('small',label),node('strong',value));k.append(cell);}c.append(k);
  c.append(node('p',`成本 ${num(p.cost)} × ${num(p.quantity,3)} 股${a.asOf?' · 行情日 '+a.asOf:''}`,'plan-note'));
  c.append(node('p',a.next||'先等完整且同日的行情與指標補齊；資料缺漏不代表安全。','next-signal'));
  const choices=node('div',undefined,'plan-choices');for(const x of a.alternatives){const box=node('div');box.append(node('strong',x.title),node('p',x.text));choices.append(box);}c.append(choices);
  const detail=node('details');detail.append(node('summary','下一個訊號與持有理由'));const checks=node('ul');
  for(const check of a.checks)checks.append(node('li',`${check.passed?'✓':'待確認'} ${check.label}${Number.isFinite(check.actual)?'（目前 '+num(check.actual)+'）':''}`));detail.append(checks,node('p',p.thesis||'尚未填寫持有理由。'),node('p','條件更完整，僅代表證據增加；這組持股規則尚未回測，沒有可宣稱的勝率。','plan-note'));c.append(detail);
  const actions=node('div',undefined,'form-actions');const edit=node('button','編輯計畫');edit.onclick=()=>openForm(p,demo);actions.append(edit);
  const archive=node('button',demo?'移除預覽':p.archived?'恢復觀察':'移出觀察');archive.disabled=!demo&&(!user||loading);archive.onclick=async()=>{if(demo){preview=null;render();return;}archive.disabled=true;try{await save({...p,archived:!p.archived},p.id,p.revision);sync('已同步，移出的持股可隨時恢復。');}catch(e){sync(errorText(e));archive.disabled=false;}};actions.append(archive);c.append(actions);return c;
}
function render(){
  const root=$('positions');root.replaceChildren();const visible=positions.filter(p=>!p.archived||$('show-archived').checked);if(preview)root.append(card(preview,true));for(const p of visible)root.append(card(p));
  if(!visible.length&&!preview)root.append(node('div',loading&&user?'正在讀取持股…':'還沒有持股計畫。新增一檔，先比較續抱、減碼與退出條件。','portfolio-empty'));
  const totals=$('portfolio-summary');totals.replaceChildren();for(const market of ['TW','US']){const list=positions.filter(p=>!p.archived&&p.market===market);if(!list.length)continue;const results=list.map(p=>{try{return L.assess(p,quote(p),data);}catch{return {};}});const known=results.filter(x=>Number.isFinite(x.value));const box=node('div');box.append(node('small',`${market==='TW'?'TWD':'USD'} · ${known.length}/${list.length} 檔可估值`),node('strong',num(known.reduce((s,x)=>s+x.value,0))),node('span',`未實現損益 ${num(known.reduce((s,x)=>s+x.pnl,0))}${known.length<list.length?' · 缺資料部分未計入':''}`));totals.append(box);}
}
function openForm(p=null,demo=false){editing=p&&!demo?{id:p.id,revision:p.revision}:null;const form=$('position-form');form.reset();form.elements.planStart.value=L.day();if(p)for(const e of form.elements)if(e.name&&p[e.name]!==undefined)e.value=p[e.name];$('form-error').textContent='';$('position-title').textContent=editing?'編輯持股計畫':'新增／試算持股';updateAuth();$('position-dialog').showModal();}
function fromForm(){const raw=Object.fromEntries(new FormData($('position-form')));raw.name=rows().find(r=>r.symbol===raw.symbol.trim().toUpperCase())?.name||raw.symbol;raw.archived=editing?!!positions.find(p=>p.id===editing.id)?.archived:false;return L.normalize(raw);}
async function save(p,id,revision=0){
  if(!user||!config?.cloud_enabled||loading)throw Error('尚未完成登入及雲端同步，未儲存。');
  const uid=user.uid,ref=F.doc(db,'rotationPortfolios',uid,'positions',id||crypto.randomUUID()),clean=L.normalize(p);
  await F.runTransaction(db,async tx=>{const current=await tx.get(ref);if((current.exists()?current.data().revision:0)!==revision)throw Error('另一個裝置已更新這筆計畫，請關閉表單後重新編輯。');if(auth.currentUser?.uid!==uid)throw Error('登入帳號已改變，請重新操作。');tx.set(ref,{...clean,revision:revision+1,updatedAt:F.serverTimestamp()});});
}
$('new-position').onclick=()=>openForm();$('close-position').onclick=()=>$('position-dialog').close();$('show-archived').onchange=render;
$('preview-position').onclick=()=>{try{preview=fromForm();$('position-dialog').close();render();$('positions').scrollIntoView({behavior:'smooth'});}catch(e){$('form-error').textContent=errorText(e);}};
$('position-form').onsubmit=async e=>{e.preventDefault();const button=$('save-position');button.disabled=true;try{await save(fromForm(),editing?.id,editing?.revision||0);preview=null;$('position-dialog').close();sync('已安全儲存到 Firebase；其他裝置登入同帳號即可同步。');render();}catch(e){$('form-error').textContent=errorText(e);}finally{updateAuth();}};
function weights(w){const box=node('div',undefined,'weight-bars');['相對強弱','加速度','趨勢','成交量','突破'].forEach((label,i)=>{const r=node('div',undefined,'weight-line'),track=node('div',undefined,'weight-track'),bar=node('span');bar.style.width=`${w[i]}%`;track.append(bar);r.append(node('span',label),track,node('span',`${w[i]}%`));box.append(r);});return box;}
function renderTraining(){
  if(!training)return;const root=$('training-result');root.replaceChildren();const m=training.markets.find(m=>m.market===$('train-market').value),r=m?.results.find(r=>r.profile===$('train-profile').value&&r.holding_days===Number($('train-horizon').value));if(!r){root.append(node('p','這個組合資料不足。'));return;}
  const labels={no_improvement:'尚未勝過基準，保留原權重',insufficient:'樣本不足，保留原權重',tradeoff:'報酬與回落有取捨，保留原權重',forward_only:'歷史較佳，仍需新資料驗證；尚未套用'};
  root.append(node('h3',labels[r.assessment]),node('p',`訓練 ${m.train_start}～${m.train_end}；歷史驗證 ${m.validation_start}～${m.validation_end}。`));
  if(training.status!=='ok'||training.refresh_status==='failed')root.append(node('p','最近更新未完成；以下保留上次結果與實際日期。','notice'));
  const comparison=node('div',undefined,'training-comparison');for(const [title,metric,w] of [['原權重排序基準',r.baseline,training.config.baseline],['訓練期選出的候選',r.candidate,r.weights]]){const a=node('article');a.append(node('h3',title),weights(w));const stats=node('div',undefined,'training-metrics');for(const [label,value] of [['驗證累積報酬',pct(metric.return_pct)],['最大回落',pct(metric.max_drawdown_pct)],['交易筆數',`${metric.trades}（期末結算 ${metric.forced_exits}）`],['歷史交易勝率',pct(metric.win_rate_pct)]]){const s=node('div');s.append(node('small',label),node('strong',value));stats.append(s);}a.append(stats);comparison.append(a);}root.append(comparison);
  root.append(node('p',`候選成本加倍後報酬 ${pct(r.double_cost.return_pct)}${r.baseline_double_cost?'；基準成本加倍 '+pct(r.baseline_double_cost.return_pct):''}。勝率包含期末結算，交易之間可能相關，不能當成你下一筆的勝率。`));
  root.append(node('p',`新前瞻期間自 ${training.forward_start} 起，固定權重後另行觀察。${r.forward?'候選累積報酬 '+pct(r.forward.return_pct)+'，'+r.forward.trades+' 筆（含期末結算 '+r.forward.forced_exits+'）；樣本仍需累積。':'尚無足夠的新前瞻資料。'}`,'notice'));
  const detail=node('details');detail.append(node('summary','訓練方法、偏好與限制'));detail.append(node('p',`11 組固定候選，三段訓練期的「年化報酬－回落懲罰」中位數選擇。保守／平衡／積極的回落懲罰分別是 1.5／0.75／0.25；只調整同時符合量價條件時的排序，不是資金配置比例。這裡的排序基準與舊頁 RS20 排序回測不同，不能直接混比。`));const ul=node('ul');for(const note of training.limitations)ul.append(node('li',note));detail.append(ul);root.append(detail);
}
for(const id of ['train-market','train-profile','train-horizon'])$(id).onchange=renderTraining;
const loaded=await Promise.allSettled([json('rotation/data.json'),json('rotation/weight_training.json'),json('rotation/portfolio_config.json')]);
if(loaded[0].status==='fulfilled'){data=loaded[0].value;$('quote-status').textContent=`完整日線：台股 ${data.markets.TW.as_of}／美股 ${data.markets.US.as_of}。每筆計畫另檢查時效；盤中價格不冒充收盤訊號。`;for(const r of rows()){const opt=node('option',r.name);opt.value=r.symbol;$('symbols').append(opt);}}else $('quote-status').textContent='公開行情讀取失敗，暫不產生持股判斷。';
if(loaded[1].status==='fulfilled'){training=loaded[1].value;renderTraining();}else $('training-result').textContent='訓練結果暫時無法讀取。';
if(loaded[2].status==='fulfilled')config=loaded[2].value;
render();
try{
  const App=await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
  [A,F]=await Promise.all([import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js')]);
  const app=App.getApps().length?App.getApp():App.initializeApp({apiKey:'AIzaSyCnHhksuhJs9RdrL7DPnsAvR21ZND7kIOI',authDomain:'stack-diagram-db.firebaseapp.com',projectId:'stack-diagram-db',storageBucket:'stack-diagram-db.firebasestorage.app',messagingSenderId:'67240747982',appId:'1:67240747982:web:1fb065e40e936a7485419f'});
  auth=A.getAuth(app);db=F.getFirestore(app);
  A.onAuthStateChanged(auth,current=>{unsubscribe?.();unsubscribe=null;user=current;positions=[];preview=null;editing=null;$('position-dialog').close();loading=!!current;updateAuth();render();
    if(!current){loading=false;sync('未登入。你可以先用試算預覽，不會儲存。');return;}
    if(!config?.cloud_enabled){loading=true;sync('雲端持股規則尚未完成確認，暫停讀寫；仍可先試算。');return;}
    const uid=current.uid;unsubscribe=F.onSnapshot(F.collection(db,'rotationPortfolios',uid,'positions'),{includeMetadataChanges:true},snap=>{if(user?.uid!==uid)return;loading=snap.metadata.fromCache;positions=snap.docs.map(d=>({...d.data(),id:d.id}));sync(loading?'正在等待伺服器確認；暫停修改。':`已與 Firebase 同步 ${positions.length} 筆持股計畫。`);updateAuth();render();},e=>{if(user?.uid!==uid)return;loading=true;positions=[];sync(errorText(e));updateAuth();render();});
  });
  $('login-form').onsubmit=async e=>{e.preventDefault();const password=$('login-password').value;$('login-password').value='';try{await A.signInWithEmailAndPassword(auth,$('login-email').value.trim(),password);}catch(e){sync(errorText(e));}};
  $('logout').onclick=async()=>{try{await A.signOut(auth);}catch(e){sync(errorText(e));}};
}catch{loading=false;updateAuth();sync('Firebase 無法連線；試算仍可使用，沒有儲存任何持股。');$('login-form').hidden=true;}
