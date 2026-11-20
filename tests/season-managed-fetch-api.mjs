import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {randomUUID} from 'node:crypto';

assert.equal(process.env.PAVILION_TEST_ISOLATED,'1');
assert.match(process.env.DATABASE_URL??'',/^file:/);
assert.equal(process.env.PAVILION_SEASON_FETCH_MODE,'cloud');
const base=process.env.BASE_URL;
const db=createClient({url:process.env.DATABASE_URL});
const source='https://www.cricinfo.com/series/ipl-2026-1510719/most-valuable-players';
const rooms=[],pending=[];
async function api(path,body,token){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)});return{status:r.status,data:await r.json()};}
const ok=result=>{assert.ok(result.status<300,`${result.status}: ${result.data.error}`);return result.data;};
const create=async()=>{const room=ok(await api('/api/rooms',{name:'Managed cloud verification',hostName:'Cloud owner'}));rooms.push(room);return room;};
const seasonPath=room=>'/api/rooms/'+room.state.code+'/season';
const read=async room=>ok(await api(seasonPath(room),undefined,room.token)).season;
const start=room=>{const result=api(seasonPath(room),{type:'fetch',expectedRevision:0},room.token);pending.push(result);return result;};
async function seedLease(url=source){const id=randomUUID(),now=Date.now();await db.execute({sql:"INSERT INTO season_source_jobs(id,source_url,status,created_at,expires_at,claimed_at,lease_expires_at,lease_token_hash) VALUES(?,?,'leased',?,?,?,?,?)",args:[id,url,now,now+120000,now,now+45000,'a'.repeat(64)]});return id;}
async function waitReservation(room){for(let i=0;i<70;i++){const rows=await db.execute({sql:'SELECT state_json FROM auction_seasons WHERE room_code=?',args:[room.state.code]});if(rows.rows[0]&&JSON.parse(rows.rows[0].state_json).fetchRequestId){await new Promise(resolve=>setTimeout(resolve,100));return;}await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Fetch reservation did not appear');}
function snapshot(){return{sourceUrl:source,provider:'espncricinfo',seriesId:'1510719',seriesName:'IPL 2026',fetchedAt:new Date().toISOString(),rows:[{providerPlayerId:'253802',name:'Virat Kohli',profileUrl:'https://www.cricinfo.com/cricketers/253802',points:-2.555,matches:7,runs:0,wickets:null,teamName:'Royal Challengers Bengaluru',battingImpact:0,bowlingImpact:-2.555}]};}
async function complete(id,value=snapshot()){await db.execute({sql:"UPDATE season_source_jobs SET status='completed',result_json=?,lease_token_hash=NULL WHERE id=?",args:[JSON.stringify(value),id]});return value;}
try{
 const first=await create(),second=await create();
 assert.deepEqual((await read(first)).sourceFetch,{mode:'cloud',available:true,lastSeenAt:null});
 assert.equal((await db.execute('SELECT count(*) AS n FROM season_source_worker_state')).rows[0].n,0,'cloud requires no desktop heartbeat');
 const disabled=await api('/api/season-source-worker',{type:'claim'},'a'.repeat(64));assert.equal(disabled.status,503);assert.equal(disabled.data.code,'SEASON_WORKER_DISABLED');
 const viewer=ok(await api('/api/rooms/'+first.state.code+'/join',{name:'Read only viewer'}));
 assert.equal((await api(seasonPath(first),{type:'fetch',expectedRevision:0},viewer.token)).status,403);
 const job=await seedLease();const a=start(first),b=start(second);await waitReservation(first);await waitReservation(second);
 assert.equal((await db.execute("SELECT count(*) AS n FROM season_source_jobs WHERE status='leased'")).rows[0].n,1,'rooms share one in-flight cloud source');
 const fresh=await complete(job);const resultA=ok(await a).season,resultB=ok(await b).season;
 assert.equal(resultA.snapshot.method,'fetch');assert.equal(resultA.snapshot.fetchedAt,fresh.fetchedAt);assert.equal(resultA.sourceRows[0].points,-2.555);assert.deepEqual(resultA.snapshot,resultB.snapshot);
 assert.doesNotMatch(JSON.stringify(resultA),/leaseToken|lease_token_hash|VERCEL_OIDC|workerToken/);
 await db.execute('DELETE FROM season_source_jobs');

 const changed=await create(),changeJob=await seedLease(),changing=start(changed);await waitReservation(changed);
 ok(await api(seasonPath(changed),{type:'configure',expectedRevision:0,sourceUrl:'https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players'},changed.token));
 await complete(changeJob);assert.equal((await changing).data.code,'SEASON_CONFLICT');assert.equal((await read(changed)).snapshot,null);
 await db.execute('DELETE FROM season_source_jobs');

 const failed=await create();ok(await api(seasonPath(failed),{type:'import',expectedRevision:0,text:'Name,Points\nVirat Kohli,12.5'},failed.token));
 const before=await read(failed),failedJob=await seedLease();const failure=api(seasonPath(failed),{type:'fetch',expectedRevision:1},failed.token);pending.push(failure);await waitReservation(failed);
 await db.execute({sql:"UPDATE season_source_jobs SET status='failed',error_json=? WHERE id=?",args:[JSON.stringify({message:'Provider unavailable',status:502,code:'SEASON_SOURCE_UNAVAILABLE'}),failedJob]});
 assert.equal((await failure).status,502);assert.deepEqual((await read(failed)).snapshot,before.snapshot);
 await db.execute('DELETE FROM season_source_jobs');

 const expired=await create(),expiredJob=await seedLease(),expiry=start(expired);await waitReservation(expired);
 await db.execute({sql:'UPDATE season_source_jobs SET lease_expires_at=? WHERE id=?',args:[Date.now()-1,expiredJob]});assert.equal((await expiry).data.code,'SEASON_CLOUD_TIMEOUT');
 await db.execute('DELETE FROM season_source_jobs');

 const deleted=await create(),deletedJob=await seedLease(),deleting=start(deleted);await waitReservation(deleted);
 ok(await api('/api/rooms/'+deleted.state.code+'/delete',{confirmationCode:deleted.state.code},deleted.token));await complete(deletedJob);assert.equal((await deleting).status,410);
 assert.equal((await db.execute({sql:'SELECT room_code FROM auction_seasons WHERE room_code=?',args:[deleted.state.code]})).rows.length,0);
 await db.execute('DELETE FROM season_source_jobs');

 await seedLease('https://www.cricinfo.com/series/ipl-2025-1449924/most-valuable-players');
 const busy=await create();assert.equal((await start(busy)).data.code,'SEASON_SOURCE_BUSY');
 await db.execute('DELETE FROM season_source_jobs');
 const now=Date.now();for(let i=0;i<4;i++)await db.execute({sql:"INSERT INTO season_source_jobs(id,source_url,status,created_at,expires_at) VALUES(?,?,'failed',?,?)",args:[randomUUID(),source,now,now+120000]});
 const limited=await create();assert.equal((await start(limited)).data.code,'SEASON_CLOUD_RATE_LIMIT');
 console.log('PASS: managed cloud readiness without any PC heartbeat, disabled legacy worker, creator authorization, shared in-flight jobs, precision, failure retention, source/CAS/deletion safety and global cost limits.');
}finally{
 await db.execute("UPDATE season_source_jobs SET status='failed',error_json='{}' WHERE status IN ('leased','queued')").catch(()=>{});
 await Promise.allSettled(pending);
 for(const room of rooms)await api('/api/rooms/'+room.state.code+'/delete',{confirmationCode:room.state.code},room.token);
 db.close();
}
