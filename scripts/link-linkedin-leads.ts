/** Dry-run first. Only writes request links, profile registry and append-only history; NEVER writes leads. */
import dotenv from 'dotenv';
import path from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Client, Databases, IndexType, Query, Permission, Role } from 'node-appwrite';
dotenv.config({ path:path.resolve('.env.local'),quiet:true });
dotenv.config({ path:path.resolve('.env'),quiet:true });
const { COLLECTIONS,DATABASE_ID } = await import('../lib/constants/appwrite');
const { leadProfileUrl } = await import('../lib/utils/linkedin-lead-protection');
const { canonicalizeLeadStatus } = await import('../lib/utils/lead-status-workflow');
const { profileDocumentId,saveLeadProfileRegistry } = await import('../lib/server/linkedin-lead-protection');
const { appendLeadHistory,leadHistoryChanges } = await import('../lib/server/lead-history');
const { listAllDocuments } = await import('../lib/server/appwrite-pagination');
const { getCurrentEasternIsoDate } = await import('../lib/utils/eastern-date');
const apply = process.argv.includes('--apply');
const planPath = path.resolve('outputs/linkedin-lead-repair/plan.json');
const out = path.dirname(planPath);mkdirSync(out,{recursive:true});
if (!process.env.APPWRITE_API_KEY || !process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID) throw new Error('Missing Appwrite credentials.');
const db = new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID).setKey(process.env.APPWRITE_API_KEY));
const actor = { id:'system:linkedin-lead-repair',name:'LinkedIn lead-link backfill' };
const hash = (v:unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const documentHash = (row:Record<string,unknown>) => hash(Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))));
const eventId = (kind:string,id:string,revision='') => `b_${hash([kind,id,revision]).slice(0,32)}`;
const collections = [
  { id:COLLECTIONS.LINKEDIN_LEAD_REGISTRY,name:'LinkedIn Lead Registry',fields:[['kind',20],['profileUrl',2048],['leadId',255]] as const,indexes:[] as string[][] },
  { id:COLLECTIONS.LEAD_HISTORY,name:'Lead History',fields:[['leadId',255],['requestId',255],['profileUrl',2048],['profileKey',40],['eventType',100],['occurredAt',64],['actorId',255],['actorName',255],['payload',60000]] as const,indexes:[['lead_history_idx','leadId'],['profile_history_idx','profileKey']] },
];
async function schemaPlan() {
  const changes:string[]=[];
  for(const collection of collections) {
    let current:any=null;
    try { current=await db.getCollection(DATABASE_ID,collection.id); } catch(e) { if((e as {code:number}).code!==404)throw e; }
    if(!current)changes.push(`CREATE ${collection.id}: server-only, document security, no browser permissions`);
    else if(current.$permissions.length || !current.documentSecurity) throw new Error(`Unexpected permissions on ${collection.id}; manual review required.`);
    for(const [key,size] of collection.fields)if(!current?.attributes.some((a:any)=>a.key===key))changes.push(`ADD ${collection.id}.${key}: required string(${size})`);
    for(const [key,attribute]of collection.indexes)if(!current?.indexes.some((i:any)=>i.key===key))changes.push(`ADD ${collection.id}.${key}: index(${attribute})`);
  }
  const requestSchema=await db.getCollection(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS);
  if(!requestSchema.attributes.some((a:any)=>a.key==='recordSource'))changes.push(`ADD ${COLLECTIONS.LINKEDIN_REQUESTS}.recordSource: optional string(30)`);
  return changes;
}
async function waitAvailable(collectionId:string,keys:string[]) {
  for(let attempt=0;attempt<45;attempt++) {
    const schema=await db.getCollection(DATABASE_ID,collectionId);
    if(keys.every(key=>schema.attributes.some((a:any)=>a.key===key&&a.status==='available')))return;
    if(schema.attributes.some((a:any)=>keys.includes(a.key)&&a.status==='failed'))throw new Error(`Attribute failed in ${collectionId}`);
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error(`Schema not ready: ${collectionId}`);
}
async function applySchema() {
  for(const collection of collections) {
    let current:any;
    try { current=await db.getCollection(DATABASE_ID,collection.id); }
    catch(e) { if((e as {code:number}).code!==404)throw e; current=await db.createCollection(DATABASE_ID,collection.id,collection.name,[],true); }
    if(current.$permissions.length || !current.documentSecurity)throw new Error('Unsafe history/registry permissions');
    for(const [key,size] of collection.fields)if(!current.attributes.some((a:any)=>a.key===key))await db.createStringAttribute(DATABASE_ID,collection.id,key,size,true);
    await waitAvailable(collection.id,collection.fields.map(([key])=>key));
    for(const [key,attribute]of collection.indexes)if(!current.indexes.some((i:any)=>i.key===key))await db.createIndex(DATABASE_ID,collection.id,key,IndexType.Key,[attribute]);
  }
  const requestSchema=await db.getCollection(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS);
  if(!requestSchema.attributes.some((a:any)=>a.key==='recordSource'))await db.createStringAttribute(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,'recordSource',30,false);
  await waitAvailable(COLLECTIONS.LINKEDIN_REQUESTS,['recordSource']);
}
async function all(collectionId:string,queries:string[]=[]) {
  const rows=await listAllDocuments<any>({ databases:db,databaseId:DATABASE_ID,collectionId,queries:[...queries,Query.orderAsc('$id')],maxPages:10000 });
  if(rows.length>=1000000)throw new Error('Incomplete scan');
  console.log(`${collectionId}: ${rows.length} records read`);return rows;
}
async function history(entry:Parameters<typeof appendLeadHistory>[1]) {
  try { await appendLeadHistory(db,entry); }
  catch(e) { if((e as {code:number}).code!==409)throw e; }
}
async function main() {
  if(!apply) {
    const schema=await schemaPlan();
    const scans=await Promise.allSettled([all(COLLECTIONS.LEADS),all(COLLECTIONS.LINKEDIN_REQUESTS),all(COLLECTIONS.USERS)]);
    if(scans.some(r=>r.status==='rejected'))throw new Error('Read-only scan failed; no partial plan produced.');
    const [leads,requests,users]=scans.map(r=>(r as PromiseFulfilledResult<any[]>).value);
    const userById=new Map(users.map((u:any)=>[u.$id,u]));
    const skipped:any[]=[];const operations:any[]=[];
    const profileMap=new Map<string,any[]>();
    for(const r of requests){const u=leadProfileUrl({linkedinProfileUrl:r.targetUrl});if(u)profileMap.set(u,[...profileMap.get(u)||[],r]);}
    const seen=new Set<string>();
    for(const lead of leads) {
      if(canonicalizeLeadStatus(lead.status)==='Not Interested'){skipped.push({leadId:lead.$id,reason:'Current status Not Interested'});continue;}
      const url=leadProfileUrl(lead.data);if(!url){skipped.push({leadId:lead.$id,reason:'No valid profile URL'});continue;}
      if(seen.has(url))throw new Error(`Multiple leads for ${url}; manual review required.`);seen.add(url);
      const matches=profileMap.get(url)||[];
      const conflicting=matches.filter((r:any)=>r.leadId&&r.leadId!==lead.$id);
      if(conflicting.length){skipped.push({leadId:lead.$id,reason:'Request already linked to another lead',requests:conflicting.map((r:any)=>r.$id)});continue;}
      const owner=userById.get(lead.ownerId);const fields=JSON.parse(lead.data||'{}');
      const importedId=`imp_${hash(lead.$id).slice(0,32)}`;
      const newRequest=matches.length?null:{ $id:importedId,accountId:'lead_history_import',agentId:lead.ownerId,
        teamLeadId:owner?.teamLeadId||null,company:String(fields.company||'Historical lead').trim()||'Historical lead',
        targetUrl:url,dateSent:`${getCurrentEasternIsoDate(new Date(lead.$createdAt))}T00:00:00.000Z`,status:'accepted',acceptedAt:null,
        leadId:lead.$id,withdrawnAt:null,isActive:true,recordSource:'lead_backfill' };
      operations.push({leadId:lead.$id,profileUrl:url,status:lead.status,ownerId:lead.ownerId,assignedToId:lead.assignedToId,
        leadRevision:lead.$updatedAt,leadHash:hash(lead),leadCreatedAt:lead.$createdAt,leadBaseline:leadHistoryChanges(null,lead),
        requests:matches.map((r:any)=>({id:r.$id,revision:r.$updatedAt,previousLeadId:r.leadId||null,needsLink:r.leadId!==lead.$id,baseline:leadHistoryChanges(null,r),dateSent:r.dateSent,acceptedAt:r.acceptedAt,withdrawnAt:r.withdrawnAt})),newRequest});
    }
    const summary={leadsRead:leads.length,requestsRead:requests.length,eligibleLeads:operations.length,
      skipNotInterested:skipped.filter(s=>s.reason==='Current status Not Interested').length,
      existingRequestsToLink:operations.reduce((n,o)=>n+o.requests.filter((r:any)=>r.needsLink).length,0),
      missingRequestsToCreate:operations.filter(o=>o.newRequest).length,leadWrites:0,leadDeletes:0};
    const plan={generatedAt:new Date().toISOString(),databaseId:DATABASE_ID,schema,summary,skipped,operations};
    const planHash=hash(plan);writeFileSync(planPath,JSON.stringify({planHash,...plan},null,2));
    writeFileSync(path.join(out,'preview.md'),['# LinkedIn lead linking dry run','',JSON.stringify(summary,null,2),'',...schema.map(s=>`- ${s}`),'','| Lead | Profile | Current status | Request links to add | Missing request to create |','|---|---|---|---|---|',...operations.map(o=>`| ${o.leadId} | ${o.profileUrl} | ${o.status} | ${o.requests.filter((r:any)=>r.needsLink).map((r:any)=>r.id).join(', ')} | ${o.newRequest?.$id||'none'} |`)].join('\n'));
    console.log(JSON.stringify({mode:'DRY RUN',planHash,summary,schema,output:planPath},null,2));return;
  }
  const plan=JSON.parse(readFileSync(planPath,'utf8'));const {planHash,...body}=plan;
  if(hash(body)!==planHash||!process.argv.includes(`--plan=${planHash}`))throw new Error('Apply requires the exact reviewed dry-run plan hash.');
  if(plan.databaseId!==DATABASE_ID)throw new Error('Plan database mismatch');
  // Verify ALL source rows before creating schema or changing requests.
  async function readIds(collectionId:string,ids:string[]){
    const rows=new Map<string,any>();
    for(let i=0;i<ids.length;i+=100){const page=await db.listDocuments(DATABASE_ID,collectionId,[Query.equal('$id',ids.slice(i,i+100)),Query.limit(100)]);for(const row of page.documents)rows.set(row.$id,row);}
    return rows;
  }
  const sources=await Promise.allSettled([
    readIds(COLLECTIONS.LEADS,plan.operations.map((o:any)=>o.leadId)),
    readIds(COLLECTIONS.LINKEDIN_REQUESTS,[...new Set<string>(plan.operations.flatMap((o:any)=>o.requests.map((r:any)=>r.id)))]),
  ]);
  if(sources.some(r=>r.status==='rejected'))throw new Error('Preflight scan failed');
  const [currentLeads,currentRequests]=sources.map(r=>(r as PromiseFulfilledResult<Map<string,any>>).value);
  for(const operation of plan.operations) {
    const lead=currentLeads.get(operation.leadId);
    if(!lead||lead.$updatedAt!==operation.leadRevision||hash(lead)!==operation.leadHash)throw new Error(`Lead changed: ${operation.leadId}. Rerun dry run.`);
    for(const request of operation.requests){const current=currentRequests.get(request.id);if(!current||current.$updatedAt!==request.revision)throw new Error(`Request changed: ${request.id}. Rerun dry run.`);}
  }
  await applySchema();console.log('Schema ready. Applying reviewed request-only plan.');
  const result={linked:0,created:0,registry:0,baselineLeads:0,skipped:[] as unknown[],errors:[] as unknown[]};
  const processOperation = async (operation:any) => {
    try {
      const lead=await db.getDocument(DATABASE_ID,COLLECTIONS.LEADS,operation.leadId);
      if(canonicalizeLeadStatus(lead.status)==='Not Interested'||lead.$updatedAt!==operation.leadRevision){result.skipped.push({leadId:lead.$id,reason:'Changed after plan'});return;}
      await history({id:eventId('lead-baseline',lead.$id),leadId:lead.$id,profileUrl:operation.profileUrl,eventType:'LEAD_HISTORY_BASELINE',actor,occurredAt:lead.$createdAt,payload:{source:'Existing lead snapshot; not a complete historical log',capturedAt:new Date().toISOString(),changes:operation.leadBaseline}});result.baselineLeads++;
      await saveLeadProfileRegistry(db,lead);result.registry++;
      for(const request of operation.requests) {
        const current=await db.getDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,request.id);
        if(current.$updatedAt!==request.revision&&current.leadId!==lead.$id)throw new Error(`Request changed: ${request.id}`);
        await history({id:eventId('request-baseline',request.id),leadId:lead.$id,requestId:request.id,profileUrl:operation.profileUrl,eventType:'REQUEST_HISTORY_BASELINE',actor,occurredAt:current.$createdAt,payload:{source:'Existing request snapshot',changes:request.baseline}});
        if(request.needsLink&&current.leadId!==lead.$id){await history({id:eventId('link-intent',request.id),leadId:lead.$id,requestId:request.id,profileUrl:operation.profileUrl,eventType:'REQUEST_LINK_ATTEMPT',actor,payload:{from:current.leadId||null,to:lead.$id,source:'backfill'}});
          await db.updateDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,request.id,{leadId:lead.$id});result.linked++;
          await history({id:eventId('linked',request.id),leadId:lead.$id,requestId:request.id,profileUrl:operation.profileUrl,eventType:'REQUEST_LINKED',actor,payload:{from:request.previousLeadId,to:lead.$id,source:'backfill'}});}
      }
      if(operation.newRequest){const {$id,...data}=operation.newRequest;
        await history({id:eventId('import-intent',lead.$id),leadId:lead.$id,requestId:$id,profileUrl:operation.profileUrl,eventType:'HISTORICAL_REQUEST_IMPORT_ATTEMPT',actor,payload:{leadCreatedAt:lead.$createdAt,acceptedAt:null,source:'lead_backfill'}});
        try{await db.createDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,$id,data,[Permission.read(Role.user(lead.ownerId)),Permission.read(Role.label('admin'))]);result.created++;}
        catch(e){if((e as {code:number}).code!==409)throw e;const existing=await db.getDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,$id);if(existing.leadId!==lead.$id||existing.recordSource!=='lead_backfill')throw e;}
        await history({id:eventId('imported',lead.$id),leadId:lead.$id,requestId:$id,profileUrl:operation.profileUrl,eventType:'HISTORICAL_REQUEST_IMPORTED',actor,payload:{leadCreatedAt:lead.$createdAt,dateSent:data.dateSent,acceptedAt:null,source:'lead_backfill',explanation:'Date copied from lead creation; actual invitation and acceptance timestamps unknown'}});}
      const after=await db.getDocument(DATABASE_ID,COLLECTIONS.LEADS,lead.$id);
      if(documentHash(after)!==documentHash(lead))throw new Error(`Lead changed during linking: ${lead.$id}`);
    }catch(error){result.errors.push({leadId:operation.leadId,message:(error as Error).message});}
  };
  for(let start=0;start<plan.operations.length;start+=8){
    await Promise.all(plan.operations.slice(start,start+8).map(processOperation));
    if(result.errors.length)break;
    if(start%80===0)console.log(JSON.stringify({processed:Math.min(start+8,plan.operations.length),...result}));
  }
  writeFileSync(path.join(out,'apply-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  if(result.errors.length)process.exitCode=1;
}
main().catch(error=>{console.error((error as Error).message);process.exitCode=1;});
