/* No paid calls here. The repository owner submits the reviewed GitHub issue. */
(function(){
  const T=window.ResearchTree,el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const link=(title,url)=>{try{const u=new URL(url);if(u.protocol!=='https:')return el('span','來源待核對');const a=el('a',title);a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return el('span','來源待核對');}};
  window.ResearchWorkspace={mount(stock,record){
    const root=el('section',undefined,'research-workspace'),heading=el('h3','研究樹：先選問題，再授權 AI'),status=el('p','正在讀取研究紀錄…','plan-note'),toolbar=el('div',undefined,'form-actions'),start=el('button','＋ 請 AI 研究這檔'),refresh=el('button','更新研究進度'),tree=el('div',undefined,'research-tree'),overview=el('div',undefined,'research-overview'),detail=el('div');
    let archive=null,all=[],selected='root';start.type=refresh.type='button';toolbar.append(start,refresh);root.append(heading,el('p','閱讀已有分支不會呼叫 AI。每次新研究或延伸，都先看問題與範圍，再由你確認。'),status,toolbar,overview,tree,detail);
    function bullets(title,items){const box=el('section');box.append(el('h4',title));const ul=el('ul');for(const s of items||[])ul.append(el('li',typeof s==='string'?s:s.text));box.append(ul);return box;}
    function authorize(parentId,question=''){
      const dialog=el('dialog',undefined,'research-authorization'),form=el('form'),input=el('textarea'),label=el('label','這次想研究的問題'),ack=el('input'),ackLabel=el('label',undefined,'research-consent'),error=el('p',undefined,'notice'),go=el('button','前往確認這一次授權'),cancel=el('button','先不研究');input.value=question||`研究 ${stock.name} ${stock.symbol} 的成長依據、財報矛盾、估值缺口，以及下一個要驗證的訊號。`;input.minLength=8;input.maxLength=500;input.rows=4;input.required=true;ack.type='checkbox';ack.required=true;label.append(input);ackLabel.append(ack,document.createTextNode('我了解問題與報告會公開在此網站／GitHub，並送至 OpenAI；不填持股、成本或私人資料。'));
      dialog.append(el('h3','這次研究，要不要開始？'),el('p',`${stock.name} ${stock.symbol} · ${parentId==='root'?'整檔研究':'延伸目前分支'}`),el('p','包含：找來源、回答這個問題、更新本股研究總覽、列出下一步建議。其他分支只提出問題，不自動執行。'),el('p','使用 GPT-5.4 mini。一次模型請求，最多 6 次網路工具呼叫，輸出上限 12,000 token（含推理）。API 另依實際用量計費，這是用量限制，並非金額封頂。','notice'));
      form.append(label,ackLabel);const actions=el('div',undefined,'form-actions');cancel.type='button';cancel.onclick=()=>dialog.close();go.type='submit';go.disabled=!archive?.enabled;actions.append(go,cancel);form.append(error,actions);dialog.append(form,el('p',archive?.enabled?'下一頁會列出完整授權內容；只有你登入 GitHub 並按下 Submit new issue，雲端才會開始。':'尚未啟用 AI 金鑰，此處只是授權預覽，沒有提出研究。','plan-note'));
      form.onsubmit=e=>{e.preventDefault();try{const url=T.issueUrl(T.request(stock.symbol,parentId,input.value));window.open(url,'_blank','noopener,noreferrer');dialog.close();}catch(e){error.textContent=e.message;}};
      dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
    }
    function draw(){
      all=T.nodes(stock.symbol,record,archive);tree.replaceChildren();overview.replaceChildren();detail.replaceChildren();const s=T.summary(all);
      status.textContent=archive?.enabled?'雲端接單已啟用。每次仍需你確認授權；沒有排程自動研究。':archive?.setup_note||'研究紀錄讀取失敗，暫停新研究。';
      const home=el('button',`研究總覽 · ${s.complete} 個已有材料的分支`);home.type='button';home.onclick=()=>{selected='root';draw();};tree.append(home);
      for(const n of all){const b=el('button',undefined,'research-node');b.type='button';const path=T.lineage(all,n.id),overdue=n.status==='running'&&Date.now()-Date.parse(n.createdAt)>20*60000;b.style.marginLeft=Math.min(path.nodes.length,5)*12+'px';b.append(el('strong',n.question||n.title),el('small',`${overdue?'進度逾時，需核對執行紀錄':({curated:'已人工核對',completed:'AI 報告完成',failed:'執行失敗',needs_setup:'需設定',running:'處理中'})[n.status]||'待處理'} · ${n.createdAt?.slice(0,10)||''}`));b.setAttribute('aria-pressed',String(n.id===selected));b.onclick=()=>{selected=n.id;draw();};tree.append(b);}
      overview.append(el('h4','目前研究地圖'),el('p',`已有 ${s.complete} 支材料。結論仍要對照來源日期；同一來源在多支出現，不算多份獨立證據。`));
      if(s.latest){const sy=s.latest.report.synthesis;overview.append(el('p',sy.summary),bullets('已找到的支持線索',sy.established),bullets('矛盾與反例',sy.conflicts),bullets('還沒回答',sy.unanswered),el('p','優先研究建議：'+sy.next_priority,'notice'),el('small',`彙整至 ${s.latest.createdAt}；新增分支後隨同一筆授權更新，不另外呼叫 AI。`));}
      else overview.append(el('p','尚無 AI 綜合結論。以下保留人工材料與待驗證問題，不能把缺資料當成看空或看多。'));
      if(selected==='root'){
        const suggestions=s.questions.length?s.questions:(record?.next_checks||['公司的主要成長來源是什麼？最新財報提供了哪些支持與反例？']);
        detail.append(el('h4','選一個問題繼續深入'));
        for(const question of suggestions){const b=el('button',question+' → 預覽研究授權','research-branch');b.type='button';b.onclick=()=>authorize('root',question);detail.append(b);}
        return;
      }
      const n=all.find(x=>x.id===selected);if(!n)return;const path=T.lineage(all,n.id);detail.append(el('p','研究路徑：總覽 → '+path.nodes.map(x=>x.question||x.title).join(' → '),'plan-note'),el('h4',n.question||n.title));
      if(n.error)detail.append(el('p',n.error,'notice'));
      const report=n.report||n;detail.append(el('p',report.conclusion||report.summary||''));
      for(const fact of report.evidence||[]){const card=el('article',undefined,'evidence-card');card.append(el('strong',({fact:'來源陳述（請核對原文）',inference:'研究推論',counterpoint:'反向證據',gap:'尚待查證'})[fact.kind]||'人工核對'),el('p',fact.claim),el('small',fact.date||''));for(const source of fact.sources||[])card.append(link(source.title||source.url,source.url));detail.append(card);}
      detail.append(bullets('下一個驗證條件',report.next_checks||[]));
      for(const branch of report.branches||[]){const b=el('button',`${branch.question} → 延伸這一支`,'research-branch');b.type='button';b.onclick=()=>authorize(n.id,branch.question);detail.append(b,el('p',branch.why||'','plan-note'));}
      if(n.status==='completed'||n.status==='curated'){const custom=el('button','＋ 我想追問其他問題');custom.type='button';custom.onclick=()=>authorize(n.id);detail.append(custom);}
      if(n.issue)detail.append(link('查看這次授權與執行紀錄',`https://github.com/${T.repo}/issues/${n.issue}`));
    }
    async function load(){refresh.disabled=true;try{const r=await fetch('rotation/ai_research.json',{cache:'no-store'});if(!r.ok)throw Error();archive=await r.json();draw();}catch{archive=null;draw();}finally{refresh.disabled=false;}}
    refresh.onclick=load;start.onclick=()=>authorize('root');load();return root;
  }};
})();
