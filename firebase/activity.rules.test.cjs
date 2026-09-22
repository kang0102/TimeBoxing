const {test,before,after,beforeEach}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp}=require('firebase/firestore');
const Journal=require('../scripts/portfolio_activity');
let env,db;
const base={schemaVersion:1,symbol:'2330.TW',market:'TW',name:'Synthetic test',cost:100,quantity:1000,durationValue:3,durationUnit:'months',profile:'balanced',maxLossPct:10,planStart:'2026-09-01',boughtOn:'',thesis:'',reviewedOn:'',archived:false,revision:1};
const path='rotationPortfolios/alice/positions/example',buy={kind:'buy',date:'2026-09-22',quantity:1000,price:120,fees:100,note:'Synthetic fixture'};
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-portfolio-activity',firestore:{rules:fs.readFileSync('test.rules','utf8')}});db=env.authenticatedContext('alice').firestore();});
beforeEach(async()=>{await env.clearFirestore();await assertSucceeds(setDoc(doc(db,path),{...base,updatedAt:serverTimestamp()}));});
after(async()=>env?.cleanup());
function change(p,input,id,last=null,client=db){const result=Journal.apply(p,input,last,id,'2026-09-22'),batch=writeBatch(client);batch.set(doc(client,path),{...result.position,updatedAt:serverTimestamp()});batch.set(doc(client,path,'activity',id),{...result.entry,createdAt:serverTimestamp()});return {...result,commit:()=>batch.commit()};}
test('owner reads holdings and journal; anonymous and another UID cannot read or list either',async()=>{
  const x=change(base,buy,'one');await assertSucceeds(x.commit());await assertSucceeds(getDoc(doc(db,path,'activity','one')));
  for(const client of [env.unauthenticatedContext().firestore(),env.authenticatedContext('bob').firestore()]){await assertFails(getDoc(doc(client,path)));await assertFails(getDocs(collection(client,path,'activity')));await assertFails(getDoc(doc(client,path,'activity','one')));await assertFails(setDoc(doc(client,path),{...base,updatedAt:serverTimestamp()}));}
});
test('atomic buy, partial sell and reverse keep holdings and realized totals in sync',async()=>{
  const x=change(base,buy,'one');await assertSucceeds(x.commit());
  const y=change(x.position,{...buy,kind:'sell',quantity:500,price:150},'two',{...x.entry,id:'one'});await assertSucceeds(y.commit());
  const z=change(y.position,{kind:'reverse'},'three',{...y.entry,id:'two'});await assertSucceeds(z.commit());assert.equal((await getDoc(doc(db,path))).data().quantity,2000);
});
test('full sale can be held at zero, plan edited and later reopened',async()=>{
  const x=change(base,{...buy,kind:'sell'},'one');await assertSucceeds(x.commit());
  const edited={...x.position,thesis:'Review',revision:x.position.revision+1};await assertSucceeds(setDoc(doc(db,path),{...edited,updatedAt:serverTimestamp()}));
  await assertSucceeds(change(edited,{...buy,quantity:100,price:80},'two',{...x.entry,id:'one'}).commit());
});
test('standalone journal insert or holdings-only ledger migration is rejected',async()=>{
  const x=Journal.apply(base,buy,null,'one','2026-09-22');
  await assertFails(setDoc(doc(db,path,'activity','one'),{...x.entry,createdAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,path),{...x.position,updatedAt:serverTimestamp()}));
});
test('history cannot be edited or deleted, and plan edits cannot erase ledger fields or alter cost',async()=>{
  const x=change(base,buy,'one');await assertSucceeds(x.commit());
  await assertFails(updateDoc(doc(db,path,'activity','one'),{note:'Changed'}));await assertFails(deleteDoc(doc(db,path,'activity','one')));
  await assertFails(setDoc(doc(db,path),{...base,revision:3,updatedAt:serverTimestamp()}));
  await assertFails(setDoc(doc(db,path),{...x.position,cost:1,revision:3,updatedAt:serverTimestamp()}));
  await assertFails(deleteDoc(doc(db,path)));
});
test('forged trade arithmetic cannot update either record',async()=>{
  const x=Journal.apply(base,buy,null,'one','2026-09-22'),batch=writeBatch(db);
  batch.set(doc(db,path),{...x.position,cost:1,updatedAt:serverTimestamp()});batch.set(doc(db,path,'activity','one'),{...x.entry,afterCost:1,createdAt:serverTimestamp()});await assertFails(batch.commit());
});
test('stale competing adjustment cannot replace a committed adjustment',async()=>{
  const first=change(base,buy,'one'),stale=change(base,buy,'two');await assertSucceeds(first.commit());await assertFails(stale.commit());
});
test('another owner cannot append a valid-looking atomic adjustment',async()=>{await assertFails(change(base,buy,'one',null,env.authenticatedContext('bob').firestore()).commit());});
test('archiving preserves journal and stops new adjustments',async()=>{
  const x=change(base,buy,'one');await assertSucceeds(x.commit());await assertSucceeds(setDoc(doc(db,path),{...x.position,archived:true,revision:3,updatedAt:serverTimestamp()}));
  const fake={...x.position,revision:3};await assertFails(change(fake,buy,'two',{...x.entry,id:'one'}).commit());await assertSucceeds(getDocs(collection(db,path,'activity')));
});
test('replaying an event id cannot append it twice',async()=>{const x=change(base,buy,'one');await assertSucceeds(x.commit());await assertFails(change(base,buy,'one').commit());});

test('intent preference can change without altering the immutable journal balances',async()=>{const x=change(base,buy,'one');await assertSucceeds(x.commit());await assertSucceeds(setDoc(doc(db,path),{...x.position,capitalIntent:'rotate',revision:3,updatedAt:serverTimestamp()}));});

const forecast=()=>({schemaVersion:1,modelVersion:'revenue-conviction-v1',symbol:'2330.TW',market:'TW',stars:4,months:2,comparison:'yoy',targetMonth:'2026-11',targetAfter:Timestamp.fromMillis(Date.now()+60*86400000),criterion:'Revenue above prior year',thesis:'Synthetic reason',invalidates:'Synthetic risk',action:'Observe',oneWayCost:.003,createdAt:serverTimestamp()});
test('subjective forecasts are owner-only and immutable',async()=>{const ref=doc(db,path,'convictions','f');await assertSucceeds(setDoc(ref,forecast()));await assertSucceeds(getDoc(ref));for(const client of [env.authenticatedContext('bob').firestore(),env.unauthenticatedContext().firestore()]){await assertFails(getDoc(doc(client,path,'convictions','f')));await assertFails(setDoc(doc(client,path,'convictions','g'),forecast()));}await assertFails(updateDoc(ref,{stars:5}));await assertFails(deleteDoc(ref));});
test('invalid stars, wrong symbol, forged timestamps and early outcomes are denied',async()=>{for(const change of [{stars:6},{stars:2.5},{symbol:'MSFT'},{createdAt:Timestamp.fromMillis(0)},{targetAfter:Timestamp.fromMillis(0)}])await assertFails(setDoc(doc(db,path,'convictions','f'),{...forecast(),...change}));await assertSucceeds(setDoc(doc(db,path,'convictions','f'),forecast()));await assertFails(setDoc(doc(db,path,'convictions','f','outcomes','one'),{kind:'yoy',hit:false,actualRevenue:110,baselineRevenue:100,sourceUrl:'https://example.com',note:'',createdAt:serverTimestamp()}));});
test('matured outcomes append corrections but cannot rewrite history or escape ownership',async()=>{await env.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),path,'convictions','f'),{...forecast(),createdAt:Timestamp.fromMillis(0),targetAfter:Timestamp.fromMillis(1)});});const result={kind:'yoy',hit:false,actualRevenue:110,baselineRevenue:100,sourceUrl:'https://example.com',note:'Synthetic fixture',createdAt:serverTimestamp()},ref=doc(db,path,'convictions','f','outcomes','one');await assertSucceeds(setDoc(ref,result));await assertFails(updateDoc(ref,{actualRevenue:999}));await assertFails(deleteDoc(ref));await assertFails(setDoc(doc(db,path,'convictions','f','outcomes','bad'),{...result,baselineRevenue:0}));const other=env.authenticatedContext('bob').firestore();await assertFails(getDoc(doc(other,path,'convictions','f','outcomes','one')));});
