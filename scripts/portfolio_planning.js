/* Transparent planning comparisons, not an estimated return or optimal holding period. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./rotation_decisions'));else root.PortfolioPlanning=factory(root.RotationDecisions);})(typeof globalThis!=='undefined'?globalThis:this,function(D){
  function build(p,row,assessment,data,held=[],now=Date.now()){
    const intent=p.capitalIntent||'undecided',a=assessment,defensive=['exit','reduce'].includes(a.status),known=!['unknown','closed'].includes(a.status);
    const reviewDays=a.horizon==='short'?5:a.horizon==='medium'?10:20;
    const original=D.assess(row,data?.markets?.[p.market]?.as_of),heldSymbols=new Set(held.filter(x=>x.quantity>0).map(x=>x.symbol));
    const candidates=intent==='rotate'&&known&&D.dailyFresh(data,p.market,now)?(data.stocks||[]).filter(x=>x.market===p.market&&x.symbol!==p.symbol).map(x=>({row:x,decision:D.assess(x,data.markets[p.market].as_of)})).filter(x=>x.decision.phase==='ready'&&x.row.smart_money?.status==='ok'&&x.row.smart_money.as_of===x.row.as_of&&x.row.smart_money.bias!=='selling').sort((a,b)=>(b.row.score||0)-(a.row.score||0)||a.row.symbol.localeCompare(b.row.symbol)).slice(0,3).map(x=>({symbol:x.row.symbol,name:x.row.name,close:x.row.close,score:x.row.score,passed:x.decision.passed,maDistance:x.row.ma20_distance,rs5:x.row.rs_5d,money:x.row.smart_money.bias,held:heldSymbols.has(x.row.symbol)})):[];
    const action=defensive?'先處理減碼／退出':a.status==='trim'?'比較續抱與部分落袋':a.status==='unknown'?'資料未齊，先等':a.status==='closed'?'部位已結束':intent==='rotate'?'先比較，再決定是否轉換':a.status==='review'?'先複查持有理由':'續抱，等下一次複查';
    const schedule=!known?'目前不估持有天數':defensive?'先檢查風險，不等計畫到期':`建議先以 ${reviewDays} 個交易日作為下一次複查點`;
    const horizonNote=a.horizon==='short'?'短期參考：先看 5 個交易日；條件維持，再比較續抱至 10／20 日。':a.horizon==='medium'?'中期參考：每 10 個交易日複查，條件維持才沿用你設定的月數。':'長期參考：每 20 個交易日檢查趨勢，每季核對基本面；以你設定的年／月期限為計畫。';
    const rotationReason=defensive?'原股續抱條件受損，先控制原部位，再比較候選；不必為了換股立刻把資金全投入。':original.phase==='ready'?'原股的四項價量條件也完整，目前沒有足夠證據認定換股更划算。':'候選的價量條件較完整，但缺少轉換後淨報酬驗證，先比較並等待確認。';
    return {intent,action,schedule,horizonNote,reviewDays,candidates,rotationReason,currentPassed:original.passed,probability:null,limitation:'天數是規劃與複查節奏，未以個股訓練出最佳期限；候選排序不是 CP 值或預期報酬，換股還有費用與錯失原股行情的風險。'};
  }
  return {build};
});
