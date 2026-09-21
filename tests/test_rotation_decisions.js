const test=require('node:test');
const assert=require('node:assert/strict');
const {assess,withETF}=require('../scripts/rotation_decisions.js');
const row={status:'ok',as_of:'2026-09-18',close:104,ma20:98,previous_high20:103,volume_ratio:1.5,rs_5d:1,return_20d:10,ma20_distance:6};
test('buy observation requires all four gates, excluding equality at prior high',()=>{
  assert.equal(assess(row,row.as_of).phase,'ready');
  assert.equal(assess({...row,close:103},row.as_of).phase,'watch');
  assert.equal(assess({...row,volume_ratio:1.49},row.as_of).phase,'watch');
  assert.equal(assess({...row,rs_5d:0},row.as_of).phase,'wait');
  assert.equal(assess({...row,ma20:104},row.as_of).phase,'wait');
});
test('hot, stale, missing and nonfinite prices never trigger',()=>{
  assert.equal(assess({...row,return_20d:26},row.as_of).phase,'hot');
  assert.equal(assess({...row,ma20_distance:16},row.as_of).phase,'hot');
  assert.equal(assess({...row,as_of:'2026-09-17'},row.as_of).phase,'missing');
  assert.equal(assess({...row,status:'stale'},row.as_of).phase,'missing');
  assert.equal(assess({...row,volume_ratio:NaN},row.as_of).phase,'missing');
});
test('ETF holdings alone cannot become a new accumulation signal',()=>{
  assert.equal(withETF(row,row.as_of,{funds:[{code:'00980A'}]}).phase,'held');
  assert.equal(withETF(row,row.as_of,{increased_funds:[{code:'00980A'}]}).phase,'ready');
  assert.equal(withETF(row,row.as_of,{new_funds:[{code:'00980A'}]}).phase,'ready');
  assert.equal(withETF(row,row.as_of,{increased_funds:[{code:'00980A'}],reduced_funds:[{code:'00985A'}]}).phase,'conflict');
});
test('ETF actions separate reductions, weak additions, conflicts and actual confirmation',()=>{
  const {etfAction}=require('../scripts/rotation_decisions.js'),e={increased_funds:[{code:'00980A',as_of:row.as_of}]};
  assert.equal(etfAction({...row,smart_money:{status:'ok',as_of:row.as_of,bias:'buying'}},row.as_of,e).action,'follow');
  assert.equal(etfAction(row,row.as_of,e).action,'wait');
  assert.equal(etfAction({...row,smart_money:{status:'ok',as_of:row.as_of,bias:'selling'}},row.as_of,e).action,'wait');
  assert.equal(etfAction({...row,close:95,rs_5d:-1},row.as_of,e).action,'avoid');
  assert.equal(etfAction(row,row.as_of,{reduced_funds:[{code:'00980A'}]}).action,'defend');
  assert.equal(etfAction(row,row.as_of,{...e,reduced_funds:[{code:'00985A'}]}).action,'wait');
  assert.equal(etfAction({...row,status:'stale'},row.as_of,{reduced_funds:[{}]}).action,'unknown');
});
test('Monday preparation uses Friday completed prices, not a raw weekend age cutoff',()=>{
  const {dailyFresh,expectedDaily}=require('../scripts/rotation_decisions.js');
  const d={generated_at:'2026-09-19T04:12:00Z',markets:{TW:{as_of:'2026-09-18',status:'ok'}}};
  const now=Date.parse('2026-09-21T09:30:00+08:00');
  assert.equal(expectedDaily('TW',now),'2026-09-18');
  assert.equal(dailyFresh(d,'TW',now),true);
  assert.equal(dailyFresh(d,'TW',Date.parse('2026-09-21T17:00:00+08:00')),false);
  assert.equal(dailyFresh(d,'TW',Date.parse('2026-09-22T10:00:00+08:00')),false);
});

test('missing labels explain a date hold, source failure or missing indicator',()=>{
  assert.equal(assess(row,null).label,'等待最新日線');
  assert.match(assess({...row,status:'stale',error:'大盤來源失敗'},row.as_of).reason,/大盤来源|大盤來源/);
  assert.match(assess({...row,volume_ratio:null},row.as_of).reason,/量比/);
});
test('older ETF movements and older institutional flows cannot produce follow',()=>{
  const {etfAction}=require('../scripts/rotation_decisions.js');
  const r={...row,smart_money:{status:'ok',as_of:row.as_of,bias:'buying'}};
  assert.equal(etfAction(r,row.as_of,{increased_funds:[{as_of:'2026-09-17'}]}).action,'wait');
  assert.equal(etfAction({...r,smart_money:{...r.smart_money,as_of:'2026-09-17'}},row.as_of,{increased_funds:[{as_of:row.as_of}]}).action,'wait');
});
