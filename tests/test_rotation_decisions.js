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
