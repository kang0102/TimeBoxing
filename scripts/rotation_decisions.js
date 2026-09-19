/* Shared, deterministic observation gates. A triggered rule is not an order. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.RotationDecisions=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function assess(row,asOf){
    const required=['close','ma20','previous_high20','volume_ratio','rs_5d','return_20d','ma20_distance'];
    if(!row||row.status!=='ok'||row.as_of!==asOf||required.some(k=>!Number.isFinite(row[k])))return {phase:'missing',checks:[],passed:0};
    const checks=[
      {kind:'ma20',target:row.ma20,actual:row.close,passed:row.close>row.ma20},
      {kind:'breakout',target:row.previous_high20,actual:row.close,passed:row.close>row.previous_high20},
      {kind:'volume',target:1.5,actual:row.volume_ratio,passed:row.volume_ratio>=1.5},
      {kind:'relative',target:0,actual:row.rs_5d,passed:row.rs_5d>0}
    ];
    const passed=checks.filter(c=>c.passed).length;
    let phase=row.return_20d>25||row.ma20_distance>15?'hot':passed===4?'ready':checks[0].passed&&checks[3].passed?'watch':'wait';
    return {phase,checks,passed};
  }
  function withETF(row,asOf,evidence){
    const price=assess(row,asOf);
    if(!evidence)return {...price,phase:'missing',reason:'ETF 持股比較尚未取得'};
    const additions=(evidence.new_funds||[]).length+(evidence.increased_funds||[]).length;
    if(!additions)return {...price,phase:'held',reason:'只有既有持股，尚無新增／增加曝險線索'};
    if((evidence.reduced_funds||[]).length)return {...price,phase:'conflict',reason:'ETF 樣本增加與減少曝險並存，先釐清分歧'};
    return price;
  }
  return {assess,withETF};
});
