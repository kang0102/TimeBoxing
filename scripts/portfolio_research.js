/* Evidence and fixed-baseline history. Never infer individual odds from market win rates. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./portfolio_logic'));else root.PortfolioResearch=factory(root.PortfolioLogic);})(typeof globalThis!=='undefined'?globalThis:this,function(L){
  function history(training,market,profile){
    const m=training?.markets?.find(x=>x.market===market);
    if(!m)return {rows:[],probability:null,note:'歷史驗證資料未齊。'};
    const rows=[5,10,20,60].map(days=>{
      const r=m.results?.find(x=>x.profile===profile&&x.holding_days===days),b=r?.baseline;
      return {days,winRate:b?.trades>0&&Number.isFinite(b.win_rate_pct)?b.win_rate_pct:null,trades:b?.trades??0,returnPct:b?.return_pct,drawdown:b?.max_drawdown_pct,doubleCost:r?.baseline_double_cost?.return_pct,forced:b?.forced_exits??0};
    });
    return {rows,probability:null,start:m.validation_start,end:m.validation_end,generatedAt:training.generated_at,forwardStart:training.forward_start,failed:training.status!=='ok'||training.refresh_status==='failed',count:m.total,note:'原權重排序策略、原觀察名單合併的歷史交易；並非這檔股票或擴廠題材的上漲機率。'};
  }
  function evidence(symbol,fundamentals,catalysts,cases,now=Date.now()){
    const record=fundamentals?.stocks?.find(x=>x.symbol===symbol);
    const related=(catalysts?.events||[]).flatMap(e=>(e.relationships||[]).filter(r=>r.symbol===symbol).map(r=>({title:e.title,date:e.published_date||e.date,kind:r.kind,description:r.description,boundary:e.boundary,sources:r.source?[{title:'關係依據',url:r.source}]:(e.sources||[])})));
    const hypotheses=(cases?.cases||[]).flatMap(c=>(c.positions||[]).filter(p=>p.symbol===symbol).map(p=>({title:c.title,date:c.baseline_date,view:p.report_view,note:c.evidence_note,wave:p.wave,role:p.role})));
    const age=record?.checked_on?(Date.parse(L.day(now))-Date.parse(record.checked_on))/86400000:null;
    return {record,related,hypotheses,needsReview:age===null||age>90||age<0,probability:null};
  }
  function waitWindow(event,months,now=Date.now()){
    const today=L.day(now),end=L.endDate({planStart:today,durationValue:months,durationUnit:'months'});
    const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&Number.isFinite(Date.parse(s));
    if(!valid(event?.window_start)||!valid(event?.window_end)||event.window_start>event.window_end)return {end,state:'unknown',text:'公司尚未提供可用時間範圍，不能估計再等幾個月。'};
    if(event.window_end<today)return {end,state:'past',text:'原時程已過，先核對是否實現或延期，不能自動當成已完成。'};
    if(event.window_start>end)return {end,state:'beyond',text:`最早規劃時間仍在你的 ${months} 個月等待範圍之外；可比較保留核心部位、縮小曝險或其他候選。`};
    if(event.window_end>end)return {end,state:'overlap',text:`規劃範圍與這 ${months} 個月部分重疊，但最晚可能更久；沒有足夠資訊縮成精確月份。`};
    return {end,state:'within',text:`規劃時間落在你的 ${months} 個月等待範圍內，仍須確認實際交付與營收；不是股價上漲倒數。`};
  }
  function scenario(assessment,hasCandidates){
    if(['exit','reduce'].includes(assessment.status))return '先處理已觸發的風險條件；擴廠消息不能抵銷目前失效訊號。';
    if(['unknown','closed'].includes(assessment.status))return '先補齊可用行情或建立有效部位，再比較續抱與轉換。';
    return hasCandidates?'可以比較原股與候選的觸發條件，但尚未驗證轉換後淨報酬。時間較短或分數較高，都不足以證明更划算。':'目前沒有已通過條件的替代候選；時間成本先列入複查，沒有證據就不勉強換股。';
  }
  return {history,evidence,waitWindow,scenario};
});
