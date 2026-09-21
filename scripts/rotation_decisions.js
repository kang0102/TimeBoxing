/* Shared, deterministic observation gates. A triggered rule is not an order. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RotationDecisions=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function assess(row,asOf){
    const required=['close','ma20','previous_high20','volume_ratio','rs_5d','return_20d','ma20_distance'];
    const missing=(label,reason)=>({phase:'missing',checks:[],passed:0,label,reason});
    if(!row||row.status!=='ok')return missing('行情未齊',row?.error||'個股行情來源暫時無法取得');
    if(!asOf)return missing('等待最新日線',`已保留 ${row.as_of||'上次'} 資料；等待最新完整日線，暫不當作今天的訊號。`);
    if(row.as_of!==asOf)return missing('個股日期落後',`個股 ${row.as_of||'未知'}，大盤 ${asOf}；日期尚未對齊。`);
    const absent=required.filter(k=>!Number.isFinite(row[k]));
    if(absent.length){const names={close:'收盤價',ma20:'月線',previous_high20:'前高',volume_ratio:'量比',rs_5d:'相對大盤強弱',return_20d:'20日漲幅',ma20_distance:'月線乖離'};return missing('指標未齊',`缺少：${absent.map(k=>names[k]).join('、')}`);}
    const checks=[
      {kind:'ma20',target:row.ma20,actual:row.close,passed:row.close>row.ma20},
      {kind:'breakout',target:row.previous_high20,actual:row.close,passed:row.close>row.previous_high20},
      {kind:'volume',target:1.5,actual:row.volume_ratio,passed:row.volume_ratio>=1.5},
      {kind:'relative',target:0,actual:row.rs_5d,passed:row.rs_5d>0}
    ];
    const passed=checks.filter(c=>c.passed).length;
    let phase=row.return_20d>25||row.ma20_distance>15?'hot':passed===4?'ready':checks[0].passed&&checks[3].passed?'watch':'wait';
    return {phase,checks,passed};
  }
  function withETF(row,asOf,evidence){
    const price=assess(row,asOf);
    if(!evidence)return {...price,phase:'missing',reason:'ETF 持股比較尚未取得'};
    if(price.phase==='missing')return price;
    const additions=(evidence.new_funds||[]).length+(evidence.increased_funds||[]).length;
    const reductions=(evidence.reduced_funds||[]).length;
    if(!additions&&reductions)return {...price,phase:'reducing',reason:'ETF 樣本減少曝險，先檢查防守條件'};
    if(!additions)return {...price,phase:'held',reason:'只有既有持股，尚無新增／增加曝險線索'};
    if(reductions)return {...price,phase:'conflict',reason:'ETF 樣本增加與減少曝險並存，先釐清分歧'};
    return price;
  }
  function etfAction(row,asOf,evidence){
    const decision=withETF(row,asOf,evidence),price=assess(row,asOf);
    const result={...decision,pricePhase:price.phase};
    if(decision.phase==='missing')return {...result,action:'unknown',reason:'持股比較或完整行情未齊，不能判斷跟進或避開。'};
    if(decision.phase==='held')return {...result,action:'unchanged',reason:'只有原有持股，不構成新的布局訊號。'};
    if(decision.phase==='conflict')return {...result,action:'wait',reason:'樣本 ETF 同時增加與減少，方向分歧；先不跟單。'};
    if(decision.phase==='reducing')return {...result,action:'defend',reason:row.close<=row.ma20?'ETF 減少曝險，股價也失守月線，防守訊號較強。':'ETF 減少曝險，但股價仍在月線上；暫不加碼，觀察支撐，不能只憑 ETF 動作判定必跌。'};
    if(price.phase==='hot')return {...result,action:'avoid',reason:'ETF 增加曝險，但股價漲幅或月線乖離偏熱，先避開追價。'};
    if(row.close<=row.ma20&&row.rs_5d<=0)return {...result,action:'avoid',reason:'ETF 增加曝險，但股價在月線下且弱於大盤；先避開接下跌中的股票。'};
    if(price.phase==='ready'){
      const moves=[...(evidence.new_funds||[]),...(evidence.increased_funds||[])];
      if(moves.some(f=>f.as_of!==asOf))return {...result,action:'wait',reason:'價格條件已成立，但基金動向仍是較早公布的持股；等最新持股確認，暫不視為今天跟進訊號。'};
      const money=row.smart_money;
      if(money?.status!=='ok'||money.as_of!==asOf)return {...result,action:'wait',reason:'四項價量條件成立，但當日法人資料未齊；補齊交叉確認後再評估。'};
      if(money.bias==='selling')return {...result,action:'wait',reason:'價量已確認，但外資＋投信偏賣；先等資金面不再背離。'};
      return {...result,action:'follow',reason:'ETF 增加曝險，四項價量條件成立、未過熱，法人也沒有偏賣；可列入分批布局評估。'};
    }
    return {...result,action:'wait',reason:row.close<=row.ma20?'ETF 增加曝險，但價格尚未站回月線；先等轉強。':'ETF 增加曝險，但突破、成交量或相對大盤條件尚未齊；先等確認。'};
  }
  function expectedDaily(market,now=Date.now(),early=false){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:market==='TW'?'Asia/Taipei':'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));
    const date=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`),cutoff=market==='TW'?(early?14*60:16*60+30):(early?16*60+30:18*60);
    if(Number(parts.hour)*60+Number(parts.minute)<cutoff)date.setUTCDate(date.getUTCDate()-1);
    while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);
    return date.toISOString().slice(0,10);
  }
  function dailyFresh(data,market,now=Date.now()){
    const age=now-Date.parse(data?.generated_at);
    const day=data?.markets?.[market]?.as_of;
    return age>=-300000&&age<=96*3600000&&day>=expectedDaily(market,now)&&day<=expectedDaily(market,now,true)&&data?.markets?.[market]?.status!=='delayed';
  }
  return {assess,withETF,etfAction,expectedDaily,dailyFresh};
});
