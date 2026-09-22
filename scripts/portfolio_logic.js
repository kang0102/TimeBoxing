/* Pure portfolio planning rules; no orders, credentials, or network operations. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./rotation_decisions.js'));else root.PortfolioLogic=factory(root.RotationDecisions);})(typeof globalThis!=='undefined'?globalThis:this,function(decisions){
  'use strict';
  const profiles={conservative:'保守',balanced:'平衡',aggressive:'積極'};
  const units={days:'天',months:'個月',years:'年'};
  const positive=n=>typeof n==='number'&&Number.isFinite(n)&&n>0;
  function dateOK(s){const d=new Date(s+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
  function day(now=Date.now()){return new Date(now).toLocaleDateString('en-CA',{timeZone:'Asia/Taipei'});}
  function normalize(p,{allowClosed=false}={}){
    const symbol=String(p.symbol||'').trim().toUpperCase(),market=p.market;
    if(!['TW','US'].includes(market)||!(market==='TW'?/^\d{4,6}\.(TW|TWO)$/:/^[A-Z][A-Z0-9.-]{0,14}$/).test(symbol))throw Error('請選擇市場並填入正確代號；台股須包含 .TW 或 .TWO。');
    const cost=Number(p.cost),quantity=Number(p.quantity),durationValue=Number(p.durationValue),maxLossPct=Number(p.maxLossPct);
    if(!positive(cost)||cost>1e7||!(positive(quantity)||allowClosed&&quantity===0)||quantity>1e9||market==='TW'&&!Number.isInteger(quantity))throw Error('成本與股數必須大於零；台股使用整數股數，1 張＝1,000 股。');
    if(!Number.isInteger(durationValue)||durationValue<1||durationValue>({days:3650,months:120,years:10}[p.durationUnit]||0))throw Error('持有期限須為正整數，最長 10 年。');
    if(!positive(maxLossPct)||maxLossPct>50)throw Error('可接受成本跌幅須大於 0%、不超過 50%。');
    if(!profiles[p.profile]||!dateOK(p.planStart)||p.boughtOn&&!dateOK(p.boughtOn)||p.reviewedOn&&!dateOK(p.reviewedOn))throw Error('偏好或日期格式不正確。');
    if(!['undecided','hold','rotate'].includes(p.capitalIntent||'undecided'))throw Error('請選擇持續持有或評估資金轉換。');
    if(p.planStart>day()||p.boughtOn&&p.boughtOn>day()||p.reviewedOn&&p.reviewedOn>day())throw Error('開始／買入／檢查日期不能在未來。');
    return {schemaVersion:1,symbol,market,name:String(p.name||symbol).trim().slice(0,80),cost,quantity,
      durationValue,durationUnit:p.durationUnit,profile:p.profile,maxLossPct,planStart:p.planStart,boughtOn:p.boughtOn||'',
      thesis:String(p.thesis||'').trim().slice(0,500),reviewedOn:p.reviewedOn||'',archived:!!p.archived,capitalIntent:p.capitalIntent||'undecided'};
  }
  function endDate(p){
    const d=new Date(p.planStart+'T12:00:00Z');
    if(p.durationUnit==='days')d.setUTCDate(d.getUTCDate()+p.durationValue);
    else {const original=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+p.durationValue*(p.durationUnit==='years'?12:1));const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(original,last));}
    return d.toISOString().slice(0,10);
  }
  function assess(p,row,data,now=Date.now()){
    const expiry=endDate(p),days=Math.round((Date.parse(expiry)-Date.parse(p.planStart))/86400000),horizon=days<=45?'short':days<=180?'medium':'long';
    const lossLine=p.cost*(1-p.maxLossPct/100),result={expiry,horizon,lossLine,expired:day(now)>=expiry,status:'unknown',title:'行情未齊，暫不判斷',checks:[],alternatives:[]};
    if(p.quantity===0&&p.schemaVersion===2)return {...result,status:'closed',title:'已全數減碼',reason:'目前沒有剩餘部位；加減碼紀錄與已實現損益仍保留。',next:'若再次買入，可新增一筆加碼紀錄，並重新檢查持有期限與理由。',price:row?.close,value:0,pnl:0,pnlPct:null};
    if(!row||row.status!=='ok'||!decisions.dailyFresh(data,p.market,now)||row.as_of!==data.markets[p.market].as_of)return {...result,reason:row?.error||'目前未追蹤這檔或最新日線未齊；不以成本或舊行情判斷安全。'};
    const price=decisions.assess(row,row.as_of);
    if(price.phase==='missing')return {...result,reason:price.reason};
    const pnlPct=(row.close/p.cost-1)*100,pnl=(row.close-p.cost)*p.quantity,value=row.close*p.quantity;
    const key=horizon==='short'?'ma20':horizon==='medium'?(p.profile==='conservative'?'ma20':'ma60'):(p.profile==='conservative'?'ma60':'ma200');
    const line=row[key],label={ma20:'20 日均線',ma60:'60 日均線',ma200:'200 日均線'}[key];
    Object.assign(result,{price:row.close,asOf:row.as_of,pnlPct,pnl,value,trendLine:line,trendLabel:label});
    if(!positive(line))return {...result,status:row.close<=lossLine?'exit':'unknown',title:row.close<=lossLine?'已觸及自訂風險線':'趨勢指標未齊',reason:`${row.close<=lossLine?'價格已觸及你設定的成本風險線，優先檢查減碼／退出計畫。':''}缺少${label}，無法完成這個持有期限的趨勢檢查。`};
    const weak=row.close<line&&(p.profile!=='aggressive'||row.rs_5d<=0),hot=price.phase==='hot',risk=row.close<=lossLine;
    const reviewAge=p.reviewedOn?(Date.parse(day(now))-Date.parse(p.reviewedOn))/86400000:Infinity;
    const reviewDue=horizon==='long'&&(!p.thesis||reviewAge>=90);
    let status='hold',title='續抱條件仍在',reason=`完整收盤仍守住${label}與你設定的成本風險線。`;
    if(risk){status='exit';title='已觸及自訂風險線';reason=`已超過你設定的可接受成本跌幅 ${p.maxLossPct}%；優先檢查減碼／退出計畫。`;}
    else if(weak){status='reduce';title='趨勢轉弱，評估減碼';reason=`收盤已低於${label}${p.profile==='aggressive'?'，且近 5 日弱於大盤':''}；先降低風險，不用延長期限掩蓋失效。`;}
    else if(result.expired){status='review';title='計畫到期，重新評估';reason='到期是重新檢查理由與資金用途的日期，不會自動視為必須賣出或無限續抱。';}
    else if(reviewDue){status='review';title='長期理由需要複查';reason='請補上持有理由，並核對營收、獲利／現金流、負債與原投資論點；看板未自動驗證這些基本面。';}
    else if(row.close<line){status='review';title='趨勢線失守，等強弱確認';reason=`收盤已低於${label}，但仍強於大盤；積極偏好尚未同時觸發減碼條件，請觀察是否收復趨勢線。`;}
    else if(hot){status='trim';title='走勢偏熱，先不追買';reason='趨勢尚未失守；可比較保留部位與部分落袋，漲多本身不代表立刻反轉。';}
    const moneyReady=row.smart_money?.status==='ok'&&row.smart_money?.as_of===row.as_of, moneySelling=moneyReady&&row.smart_money.bias==='selling';
    result.checks=[{label:`守住${label}`,target:line,actual:row.close,passed:row.close>=line},{label:'突破前 20 日高點',target:row.previous_high20,actual:row.close,passed:row.close>row.previous_high20},{label:'收盤量比 ≥ 1.5',target:1.5,actual:row.volume_ratio,passed:row.volume_ratio>=1.5},{label:'近 5 日強於大盤',target:0,actual:row.rs_5d,passed:row.rs_5d>0},{label:'法人／資金指標已齊且非偏賣',target:null,actual:null,passed:moneyReady&&!moneySelling}];
    const nextHigh=row.next_session_high20,nextMeanVolume=row.next_session_volume_mean20;
    const nextEntry=positive(nextHigh)&&positive(nextMeanVolume)?`${price.phase==='ready'?'本次收盤四項價量已達標。':''}下一交易日以 ${row.as_of} 日線準備：等收盤突破 ${nextHigh.toFixed(2)}、全日成交量至少 ${Math.ceil(nextMeanVolume*1.5).toLocaleString('zh-TW')} 股（基準均量 1.5 倍），並守住趨勢線、近 5 日強於大盤；當日法人／資金資料也須補齊且非偏賣。盤中越過不算收盤確認，長期計畫另需核對基本面。`:'下一交易日的前高或均量基準未齊；先等更新，不沿用本次收盤的舊突破門檻。';
    const next=risk?`先處理自訂風險線 ${lossLine.toFixed(2)}；不要把等反彈當作已驗證的退出策略。`:weak?`先等收盤重新站回 ${label} ${line.toFixed(2)}，再看相對大盤轉強。`:hot?'先等漲幅／乖離降溫且支撐維持，再評估是否增加部位。':nextEntry;
    result.alternatives=[{title:'續抱',text:!risk&&!weak?'保留部位，持續核對趨勢線、自訂風險線與計畫到期日。':'續抱條件已受損；若保留部位，先寫明可接受的額外風險。'},
      {title:'部分減碼',text:risk||weak||hot?'可降低曝險，剩餘部位沿用明確失效條件；不預設固定賣出比例。':'目前沒有單靠價格必須減碼的訊號；若部位過度集中，仍需另行調整。'},
      {title:'退出／重新檢查',text:risk?'自訂風險線已觸發，優先評估退出。實際成交可能有跳空及成本。':`若收盤失守 ${line.toFixed(2)}、觸及成本風險線，或持有理由失效，重新評估退出。`}];
    const nextItems=risk||weak||hot||!positive(nextHigh)||!positive(nextMeanVolume)?[next]:[
      `收盤價：突破 ${nextHigh.toFixed(2)}`,
      `全日成交量：至少 ${Math.ceil(nextMeanVolume*1.5).toLocaleString('zh-TW')} 股${p.market==='TW'?'（約 '+Math.ceil(nextMeanVolume*1.5/1000).toLocaleString('zh-TW')+' 張）':''}，即基準均量 1.5 倍`,
      `趨勢：守住${label} ${line.toFixed(2)}`,
      '相對強弱：近 5 日表現強於大盤',
      '資金：當日資料已齊且非偏賣；長期計畫另核對基本面'
    ];
    return {...result,status,title,reason,next,nextItems,nextHeading:price.phase==='ready'?'本次四項價量已達標；下一交易日再核對':'下一交易日：等待條件',nextNote:`基準 ${row.as_of} 完整日線；盤中穿越不算收盤確認。`,hot,reviewDue,moneyReady,moneySelling,probability:null};
  }
  return {profiles,units,normalize,endDate,assess,day};
});
