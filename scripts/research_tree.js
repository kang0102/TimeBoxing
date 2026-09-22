/* Public research only. Opening a node never invokes AI or writes a request. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ResearchTree=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const policy='research-once-v1',profile='bounded-web-v1',repo='kang0102/TimeBoxing';
  function request(symbol,parentId,question){
    if(!/^(?:\d{4,6}\.(?:TW|TWO)|[A-Z][A-Z0-9.-]{0,14})$/.test(symbol))throw Error('股票代號格式不正確');
    if(!/^(?:root|seed-[a-z0-9-]{1,40}|issue-\d+)$/.test(parentId))throw Error('研究分支格式不正確');
    question=String(question||'').trim();if(question.length<8||question.length>500)throw Error('請用 8～500 字寫明這次想查的問題');
    return {policy,profile,symbol,parentId,question,approveOnce:true};
  }
  function issueUrl(req){
    const checked=request(req.symbol,req.parentId,req.question),url=new URL(`https://github.com/${repo}/issues/new`);
    url.searchParams.set('title',`[AI 研究授權] ${checked.symbol}`);
    url.searchParams.set('body','我授權這一筆公開股票研究與本次分支彙整。僅一次模型請求，最多 6 次網路工具呼叫、12,000 輸出 token（含推理），API 依實際用量計費，並非金額封頂。不得自動延伸、重跑或交易。\n\n公開範圍：股票、問題、來源及報告。內容會送至 OpenAI；不包含持股成本或私人筆記。\n\n```json\n'+JSON.stringify(checked,null,2)+'\n```');
    return url.href;
  }
  function nodes(symbol,record,archive){
    const seed=(record?.research_tree||[]).map(s=>({...s,id:'seed-'+s.id,parentId:'root',symbol,status:'curated',createdAt:record.checked_on}));
    return [...seed,...(archive?.nodes||[]).filter(n=>n.symbol===symbol)];
  }
  function lineage(all,id){
    const result=[],seen=new Set();let cursor=id;
    while(cursor&&cursor!=='root'){
      if(seen.has(cursor))return {nodes:result,error:'分支關係異常'};seen.add(cursor);
      const n=all.find(x=>x.id===cursor);if(!n)return {nodes:result,error:'上層分支未載入'};
      result.unshift(n);cursor=n.parentId;
    }
    return {nodes:result,error:null};
  }
  function summary(all){
    const complete=all.filter(n=>n.status==='completed'||n.status==='curated'),latest=complete.filter(n=>n.report?.synthesis).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    return {complete:complete.length,pending:all.filter(n=>!['completed','curated','failed','needs_setup'].includes(n.status)).length,latest,
      questions:[...new Set(complete.flatMap(n=>(n.report?.branches||n.branches||[]).map(b=>b.question)))].slice(0,12)};
  }
  return {policy,profile,repo,request,issueUrl,nodes,lineage,summary};
});
