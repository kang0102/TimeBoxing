const test=require('node:test'),assert=require('node:assert/strict'),L=require('../scripts/portfolio_logic');
const now=Date.parse('2026-09-21T10:00:00Z');
const data={generated_at:'2026-09-21T09:00:00Z',markets:{TW:{as_of:'2026-09-21',status:'ok'}}};
const p={symbol:'2330.TW',market:'TW',cost:100,quantity:1000,durationValue:3,durationUnit:'months',profile:'balanced',maxLossPct:10,planStart:'2026-09-01',boughtOn:'',thesis:'持續核對訂單',reviewedOn:'2026-09-01'};
const row={status:'ok',as_of:'2026-09-21',close:110,ma20:100,ma60:95,ma200:90,previous_high20:108,volume_ratio:1.6,rs_5d:3,return_20d:10,ma20_distance:10,smart_money:{status:'ok',as_of:'2026-09-21',bias:'buying'}};
test('calendar horizons clamp month and leap-year ends',()=>{assert.equal(L.endDate({...p,planStart:'2024-01-31',durationValue:1}),'2024-02-29');assert.equal(L.endDate({...p,planStart:'2024-02-29',durationValue:1,durationUnit:'years'}),'2025-02-28');});
test('rejects malformed dates, fractional TW shares and unsupported horizon',()=>{for(const change of [{planStart:'2026-99-99'},{quantity:.5},{durationUnit:'years',durationValue:11}])assert.throws(()=>L.normalize({...p,...change}));});
test('stale or partial data never produces hold advice',()=>{assert.equal(L.assess(p,row,{...data,generated_at:'2026-09-01'},now).status,'unknown');assert.equal(L.assess(p,{...row,previous_high20:null},data,now).status,'unknown');});
test('risk limit overrides long horizon and recent thesis review',()=>{const a=L.assess({...p,durationUnit:'years'}, {...row,close:89},data,now);assert.equal(a.status,'exit');assert.equal(a.probability,null);});
test('time horizon changes reference line, not a promised win probability',()=>{assert.equal(L.assess(p,row,data,now).trendLabel,'60 日均線');const a=L.assess({...p,durationUnit:'years'},row,data,now);assert.equal(a.trendLabel,'200 日均線');assert.equal(a.probability,null);});
test('missing long-term average is unknown, no silent fallback',()=>assert.equal(L.assess({...p,durationUnit:'years'},{...row,ma200:null},data,now).status,'unknown'));
test('expiry prompts review, never an automatic sell',()=>assert.equal(L.assess({...p,planStart:'2025-01-01'},row,data,now).status,'review'));
test('aggressive plan needs relative weakness before trend reduction',()=>{assert.equal(L.assess({...p,profile:'aggressive'},{...row,ma60:115},data,now).status,'review');assert.equal(L.assess({...p,profile:'aggressive'},{...row,ma60:115,rs_5d:-1},data,now).status,'reduce');});
test('missing long average cannot hide a known breached cost limit',()=>assert.equal(L.assess({...p,durationUnit:'years'},{...row,close:85,ma200:null},data,now).status,'exit'));

test('next session advances targets while completed-session checks keep their original baseline',()=>{
  const a=L.assess(p,{...row,next_session_high20:116,next_session_volume_mean20:1234567},data,now);
  assert.equal(a.status,'hold');
  assert.equal(a.checks.find(c=>c.label==='突破前 20 日高點').target,108);
  assert.equal(a.checks.find(c=>c.label==='突破前 20 日高點').passed,true);
  assert.match(a.next,/本次收盤四項價量已達標/);
  assert.match(a.next,/2026-09-21/);
  assert.match(a.next,/116\.00/);
  assert.match(a.next,/1,851,851 股/);
  assert.doesNotMatch(a.next,/108\.00/);
  assert.match(a.next,/盤中越過不算收盤確認/);
});
test('missing next-session references never recycle a completed-session breakout threshold',()=>{
  for(const change of [{next_session_high20:null},{next_session_volume_mean20:0},{next_session_volume_mean20:NaN}]){
    const a=L.assess(p,{...row,next_session_high20:116,next_session_volume_mean20:1000,...change},data,now);
    assert.equal(a.status,'hold');
    assert.match(a.next,/基準未齊/);
    assert.doesNotMatch(a.next,/108\.00/);
  }
});
test('risk, weak trend and overheating still take precedence over next-entry preparation',()=>{
  const current={...row,next_session_high20:116,next_session_volume_mean20:1000};
  for(const change of [{close:89},{close:94},{return_20d:30}]){
    const a=L.assess(p,{...current,...change},data,now);
    assert.ok(['exit','reduce','trim'].includes(a.status));
    assert.doesNotMatch(a.next,/116\.00/);
  }
});
