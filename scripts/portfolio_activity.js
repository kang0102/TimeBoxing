/* An owner's manual execution journal. Never sends broker orders. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PortfolioActivity=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const round=n=>Number(n.toFixed(8));
  function dateOK(s){const d=new Date(s+'T12:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;}
  function apply(position,input,last,id,today){
    if(position.archived)throw Error('請先恢復觀察，再新增加減碼紀錄。');
    if(!finite(position.quantity)||position.quantity<0||!finite(position.cost)||position.cost<=0)throw Error('目前持股成本或股數不完整。');
    if(!id||id===position.lastActivityId)throw Error('紀錄識別碼重複，請重新開啟表單。');
    if(position.activityCount&&(!last||last.id!==position.lastActivityId))throw Error('最後一筆紀錄尚未同步，請稍後重試。');
    const kind=input.kind,reverse=kind==='reverse';
    if(!['buy','sell','reverse'].includes(kind))throw Error('請選擇加碼或減碼。');
    let date=input.date,quantity=Number(input.quantity),price=Number(input.price),fees=Number(input.fees||0),note=String(input.note||'').trim();
    let afterQuantity,afterCost,realizedPnl=0,reversesId='';
    if(reverse){
      if(!last||last.kind==='reverse')throw Error('目前沒有可撤回的最後一筆買賣。');
      if(position.quantity!==last.afterQuantity||position.cost!==last.afterCost)throw Error('持股與最後紀錄不一致，暫不撤回。');
      date=last.date;quantity=last.quantity;price=last.price;fees=last.fees;
      afterQuantity=last.beforeQuantity;afterCost=last.beforeCost;realizedPnl=-last.realizedPnl;reversesId=last.id;
      note=note||'撤回最後一筆登錄；原紀錄仍保留。';
    }else{
      if(!finite(quantity)||quantity<=0||quantity>1e9||round(quantity)!==quantity||position.market==='TW'&&!Number.isInteger(quantity))throw Error('請輸入正確股數；台股用整數股，美股最多 8 位小數。');
      if(!finite(price)||price<=0||price>1e7)throw Error('成交單價必須大於零。');
      if(!finite(fees)||fees<0||fees>quantity*price)throw Error('費用不得為負數或超過成交金額。');
      if(kind==='sell'&&quantity>position.quantity)throw Error('減碼股數不能超過目前持股。');
      afterQuantity=round(position.quantity+(kind==='buy'?quantity:-quantity));
      afterCost=kind==='buy'?(position.quantity*position.cost+quantity*price+fees)/afterQuantity:position.cost;
      if(kind==='sell')realizedPnl=(price-position.cost)*quantity-fees;
    }
    if(!dateOK(date)||date>today||position.boughtOn&&date<position.boughtOn||last&&date<last.date)throw Error('成交日不可在未來或早於買入日／最後一筆紀錄；請按日期依序補登。');
    if(note.length>500)throw Error('原因最多 500 字。');
    if(!finite(afterCost)||afterCost<=0||afterCost>1e7||afterQuantity<0||afterQuantity>1e9)throw Error('調整後成本或股數超出範圍。');
    const revision=(position.revision||0)+1;
    const entry={schemaVersion:1,kind,date,quantity,price,fees,note,beforeQuantity:position.quantity,beforeCost:position.cost,afterQuantity,afterCost,realizedPnl,reversesId,revision};
    const updated={...position,schemaVersion:2,quantity:afterQuantity,cost:afterCost,activityCount:(position.activityCount||0)+1,lastActivityId:id,realizedPnl:(position.realizedPnl||0)+realizedPnl,revision};
    return {entry,position:updated};
  }
  return {apply};
});
