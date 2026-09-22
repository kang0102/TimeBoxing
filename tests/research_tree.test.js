const test=require('node:test'),assert=require('node:assert/strict'),T=require('../scripts/research_tree');
test('authorization URL contains one bounded request, never holdings or automatic branches',()=>{
 const req=T.request('6274.TWO','seed-cash','台燿的現金流為何與獲利不同步？'),url=new URL(T.issueUrl(req));
 assert.equal(url.origin,'https://github.com');assert.equal(req.approveOnce,true);assert.equal(req.profile,'bounded-web-v1');
 const body=url.searchParams.get('body');assert.match(body,/不得自動延伸/);assert.equal((body.match(/```json/g)||[]).length,1);
 assert.deepEqual(Object.keys(req).sort(),['approveOnce','parentId','policy','profile','question','symbol']);
 assert.throws(()=>T.request('6274.TWO','../secret','研究我的股票？'));assert.throws(()=>T.request('6274.TWO','root','abc'));
});
test('branches are stock-scoped and cycles cannot loop forever',()=>{
 const list=T.nodes('6274.TWO',{checked_on:'2026-09-23',research_tree:[{id:'cash',title:'現金流'}]},{nodes:[{id:'issue-1',symbol:'2454.TW'},{id:'issue-2',symbol:'6274.TWO',parentId:'seed-cash',status:'completed',createdAt:'2026-09-23'}]});
 assert.equal(list.length,2);assert.deepEqual(T.lineage(list,'issue-2').nodes.map(n=>n.id),['seed-cash','issue-2']);
 assert.ok(T.lineage([{id:'loop',parentId:'loop'}],'loop').error);assert.ok(T.lineage([],'missing').error);
});
test('overview excludes failed output and deduplicates proposed questions without executing them',()=>{
 const s=T.summary([{status:'failed',report:{synthesis:{summary:'invalid'}}},{status:'curated',branches:[{question:'下一季呢？'},{question:'下一季呢？'}]},{status:'completed',createdAt:'2026-09-23',report:{synthesis:{summary:'完成'},branches:[]}}]);
 assert.equal(s.complete,2);assert.equal(s.latest.report.synthesis.summary,'完成');assert.deepEqual(s.questions,['下一季呢？']);
});
