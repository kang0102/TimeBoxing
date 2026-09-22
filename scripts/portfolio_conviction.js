/* Subjective revenue conviction, immutable forecasts and a separate forward price proxy. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./portfolio_logic'));else root.PortfolioConviction=factory(root.PortfolioLogic);})(typeof globalThis!=='undefined'?globalThis:this,function(L){
  const VERSION='revenue-conviction-v1';
  function target(months,now=Date.now()){
    if(![1,2,3,6].includes(months))throw Error('請選擇 1、2、3 或 6 個月。');
    const end=L.endDate({planStart:L.day(now),durationValue:months,durationUnit:'months'}),month=end.slice(0,7);
    const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);
    return {month,after:d.toISOString(),end};
  }
  function advice(stars,a){
    if(!Number.isInteger(stars)||stars<1||stars>5)return '先選擇你對這個論點的信心。';
    if(['exit','reduce'].includes(a.status))return '先處理風險線／趨勢失效，評估減碼或退出；高星等不能蓋掉風險。';
    if(['unknown','closed'].includes(a.status))return '先補齊行情與有效持股計畫；星等暫時只記錄你的研究看法。';
    if(a.hot||a.status==='trim')return '即使看好基本面，價格偏熱時先不追買；比較保留部位與部分落袋。';
    if(stars<=2)return '你對持有理由已有疑慮：先複查持有假設，再比較降低曝險或資金轉換。';
    if(stars===3)return '信心仍待驗證：以原部位觀察下一次營收／訂單證據，先等價量與資金確認。';
    if(a.checks?.length>=5&&a.checks.every(c=>c.passed))return '你的論點信心高且本次條件完整：可把分批加碼列為待評估方案；先確認估值、集中度與可承受回落，下一交易日仍須重查。';
    return '有具體理由等待驗證：可沿用續抱計畫，逐條等價量／資金條件補齊；尚不因星等高就加碼。';
  }
  function make(input,p,a,now=Date.now()){
    const stars=Number(input.stars),months=Number(input.months),t=target(months,now);
    if(!Number.isInteger(stars)||stars<1||stars>5)throw Error('請選 1～5 顆星。');
    if(!['yoy','mom','custom'].includes(input.comparison))throw Error('請選擇營收比較方式。');
    const criterion=String(input.criterion||'').trim();if(!criterion||criterion.length>500)throw Error('請寫下明確的驗證條件，最多 500 字。');
    const thesis=String(input.thesis||'').trim(),invalidates=String(input.invalidates||'').trim();
    if(!thesis||thesis.length>1000||!invalidates||invalidates.length>500)throw Error('請填寫成長依據與看錯條件，分別最多 1,000／500 字。');
    return {schemaVersion:1,modelVersion:VERSION,symbol:p.symbol,market:p.market,stars,months,comparison:input.comparison,targetMonth:t.month,targetAfter:t.after,criterion,thesis,invalidates,action:advice(stars,a),oneWayCost:p.market==='TW'?.003:.001};
  }
  function timestamp(value){return typeof value?.toMillis==='function'?value.toMillis():typeof value?.seconds==='number'?value.seconds*1000:Date.parse(value);}
  function forward(f,prices,now=Date.now()){
    const recorded=timestamp(f.createdAt),after=timestamp(f.targetAfter);
    if(!Number.isFinite(recorded)||!Number.isFinite(after))return {status:'missing',note:'紀錄時間未同步，暫不計算。'};
    if(after>now)return {status:'pending',note:'尚未到驗證月份結束，保留原星等等待新資料。'};
    const market=prices?.markets?.[f.market],stock=prices?.stocks?.[f.symbol];
    if(!market?.dates?.length||!stock?.bars?.length)return {status:'missing',note:'前瞻日線尚未齊，不計算報酬。'};
    const day=L.day(recorded),deadline=new Date(after-1).toISOString().slice(0,10),dates=market.dates;
    // The snapshot must span the recording day, otherwise a pruned entry could shift forward silently.
    if(dates[0]>day)return {status:'missing',note:'歷史已不足以覆蓋記錄起點，不能改用較晚的價格。'};
    const entry=dates.find(d=>d>day),exit=dates.find(d=>d>=deadline);
    if(!entry||!exit||entry>exit)return {status:'pending',note:'等待期限後首個完整交易日，不用盤中價格結算。'};
    const days=dates.filter(d=>d>=entry&&d<=exit),byDay=new Map(stock.bars.map(b=>[b[0],b]));
    if(days.some(d=>!byDay.has(d)))return {status:'missing',note:'持有區間有缺日，不能假設可成交。'};
    const rows=days.map(d=>byDay.get(d)),open=rows[0][1],close=rows.at(-1)[2],cost=f.oneWayCost;
    if(![open,close,...rows.map(r=>r[2])].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(cost)||cost<0)return {status:'missing',note:'價格或成本欄位無效。'};
    const net=c=>(close*(1-c)/(open*(1+c))-1)*100;
    let peak=open*(1+cost),drawdown=0;for(const r of rows){const value=r[2]*(1-cost);peak=Math.max(peak,value);drawdown=Math.min(drawdown,(value/peak-1)*100);}
    return {status:'complete',entry,exit,returnPct:net(cost),doubleCost:net(cost*2),drawdown,win:net(cost)>0,note:'登錄日後首個交易日開盤買入，驗證月底後首個完整收盤結束；是持有價格代理，不是實際交易或加減碼策略。'};
  }
  function revenue(outcome){
    if(outcome?.kind==='custom'){if(typeof outcome.hit!=='boolean'||!outcome.note?.trim())throw Error('請記錄是否實現和驗證理由。');const u=new URL(outcome.sourceUrl);if(u.protocol!=='https:')throw Error('請使用 HTTPS 來源');return {hit:outcome.hit,growthPct:null};}
    const actual=Number(outcome.actualRevenue),base=Number(outcome.baselineRevenue);
    if(!Number.isFinite(actual)||actual<0||!Number.isFinite(base)||base<=0)throw Error('營收須為有效數字，比較期營收須大於零；兩者使用相同單位。');
    const url=new URL(outcome.sourceUrl);if(url.protocol!=='https:')throw Error('請填入 HTTPS 公告來源。');
    return {growthPct:(actual/base-1)*100,hit:actual>base};
  }
  function summarize(rows,prices,now=Date.now()){
    const earliest=new Map();for(const r of [...rows].sort((a,b)=>timestamp(a.createdAt)-timestamp(b.createdAt))){const key=r.symbol+'|'+r.targetMonth+'|'+r.comparison+'|'+(r.comparison==='custom'?r.criterion:'');if(!earliest.has(key))earliest.set(key,r);}
    return [1,2,3,4,5].map(stars=>{
      const list=[...earliest.values()].filter(r=>r.stars===stars),outcomes=list.filter(r=>{try{revenue(r.outcome);return true;}catch{return false;}}),matured=list.map(r=>forward(r,prices,now)).filter(r=>r.status==='complete');
      const hits=outcomes.filter(r=>{try{return revenue(r.outcome).hit;}catch{return false;}}).length;
      return {stars,forecasts:list.length,revenueSamples:outcomes.length,revenueHits:hits,priceSamples:matured.length,priceWins:matured.filter(r=>r.win).length};
    });
  }
  return {VERSION,target,advice,make,timestamp,forward,revenue,summarize};
});
