const test=require('node:test'),assert=require('node:assert/strict'),R=require('../scripts/portfolio_research');
const now=Date.parse('2026-09-23T01:00:00Z');
test('history uses fixed baseline, never candidate or individual probability',()=>{
 const h=R.history({status:'ok',markets:[{market:'TW',results:[{profile:'balanced',holding_days:5,baseline:{trades:40,win_rate_pct:55},candidate:{trades:99,win_rate_pct:99}}]}]},'TW','balanced');
 assert.deepEqual(h.rows.map(x=>x.days),[5,10,20,60]);assert.equal(h.rows[0].winRate,55);assert.equal(h.probability,null);assert.equal(h.rows[1].winRate,null);
});
test('zero samples or nonfinite rates do not create a winning probability',()=>{for(const b of [{trades:0,win_rate_pct:90},{trades:30,win_rate_pct:null}])assert.equal(R.history({markets:[{market:'TW',results:[{profile:'balanced',holding_days:5,baseline:b}]}]},'TW','balanced').rows[0].winRate,null);});
test('failed refresh preserves dates and labels old evidence',()=>{const h=R.history({status:'ok',refresh_status:'failed',markets:[{market:'TW',validation_end:'2026-09-17'}]},'TW','balanced');assert.equal(h.failed,true);assert.equal(h.end,'2026-09-17');});
test('waiting budget compares calendar windows without a return forecast',()=>{
 assert.equal(R.waitWindow({window_start:'2027-01-01',window_end:'2028-12-31'},2,now).state,'beyond');
 assert.equal(R.waitWindow({window_start:'2026-07-01',window_end:'2026-12-31'},2,now).state,'overlap');
 assert.equal(R.waitWindow({window_start:'2026-10-01',window_end:'2026-10-31'},2,now).state,'within');
});
test('elapsed or missing deadlines cannot imply a completed factory',()=>{assert.equal(R.waitWindow({window_start:'2026-01-01',window_end:'2026-06-30'},2,now).state,'past');assert.equal(R.waitWindow({},2,now).state,'unknown');});
test('only matching stock evidence is attached and hypotheses remain hypotheses',()=>{const e=R.evidence('3037.TW',{stocks:[{symbol:'2308.TW',checked_on:'2026-09-23'}]},{events:[{relationships:[{symbol:'3037.TW',kind:'hypothesis'}]}]},{cases:[]},now);assert.equal(e.record,undefined);assert.equal(e.related[0].kind,'hypothesis');assert.equal(e.probability,null);assert.equal(e.needsReview,true);});
test('fundamental claims never override a breached risk condition',()=>assert.match(R.scenario({status:'exit'},true),/先處理已觸發的風險/));
test('financial evidence uses matching periods and missing values cannot become negative growth',()=>{
 const raw={revenue:120,priorRevenue:100,operatingProfit:30,priorOperatingProfit:20,depreciation:15,priorDepreciation:10,operatingCash:40,capex:100};
 const values=R.financial({financial:raw}).map(x=>Math.round(x.value));assert.deepEqual(values,[20,50,50,40]);
 assert.equal(R.financial({financial:{...raw,revenue:null,capex:0}}).length,2);
 assert.equal(R.focus(null,{group_name:'金融保險'}).specific,false);assert.match(R.focus(null,{group_name:'金融保險'}).questions[0],/利差/);
});
