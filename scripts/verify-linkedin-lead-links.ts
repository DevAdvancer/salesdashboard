/** Read-only verification of the reviewed LinkedIn request backfill. */
import dotenv from 'dotenv';import path from 'node:path';import{readFileSync,writeFileSync}from'node:fs';
import{Client,Databases,Query}from'node-appwrite';
dotenv.config({path:path.resolve('.env.local'),quiet:true});dotenv.config({path:path.resolve('.env'),quiet:true});
const{COLLECTIONS,DATABASE_ID}=await import('../lib/constants/appwrite');
const{listAllDocuments}=await import('../lib/server/appwrite-pagination');
const{profileDocumentId}=await import('../lib/server/linkedin-lead-protection');
const{getCurrentEasternIsoDate}=await import('../lib/utils/eastern-date');
const db=new Databases(new Client().setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!).setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!).setKey(process.env.APPWRITE_API_KEY!));
const dir=path.resolve('outputs/linkedin-lead-repair');const plan=JSON.parse(readFileSync(path.join(dir,'plan.json'),'utf8'));
async function readIds(collection:string,ids:string[]){const map=new Map<string,any>();for(let i=0;i<ids.length;i+=100){const page=await db.listDocuments(DATABASE_ID,collection,[Query.equal('$id',ids.slice(i,i+100)),Query.limit(100)]);page.documents.forEach(row=>map.set(row.$id,row));}return map;}
const scans=await Promise.allSettled([
  listAllDocuments<any>({databases:db,databaseId:DATABASE_ID,collectionId:COLLECTIONS.LEADS,queries:[Query.orderAsc('$id')]}),
  readIds(COLLECTIONS.LINKEDIN_REQUESTS,[...new Set<string>(plan.operations.flatMap((o:any)=>[...o.requests.map((r:any)=>r.id),o.newRequest?.$id].filter(Boolean)))]),
  listAllDocuments<any>({databases:db,databaseId:DATABASE_ID,collectionId:COLLECTIONS.LINKEDIN_LEAD_REGISTRY,queries:[Query.orderAsc('$id')]}),
  listAllDocuments<any>({databases:db,databaseId:DATABASE_ID,collectionId:COLLECTIONS.LEAD_HISTORY,queries:[Query.orderAsc('$id')]}),
]);
if(scans.some(r=>r.status==='rejected'))throw new Error('Verification scan failed');
const[leadRows,requests,registry,history]=scans.map(r=>(r as PromiseFulfilledResult<any>).value);
const leads=new Map<string,any>(leadRows.map((lead:any)=>[lead.$id,lead]));
const registryById=new Map(registry.map((r:any)=>[r.$id,r]));const errors:any[]=[];
for(const operation of plan.operations){
 const lead=leads.get(operation.leadId);
 if(!lead||lead.$updatedAt!==operation.leadRevision||lead.ownerId!==operation.ownerId||lead.assignedToId!==operation.assignedToId||lead.status!==operation.status)errors.push({leadId:operation.leadId,reason:'Lead metadata changed'});
 if((registryById.get(profileDocumentId(operation.profileUrl)) as any)?.leadId!==operation.leadId)errors.push({leadId:operation.leadId,reason:'Registry mismatch'});
 for(const prior of operation.requests){const row=requests.get(prior.id);if(!row||row.leadId!==operation.leadId||row.dateSent!==prior.dateSent||row.acceptedAt!==prior.acceptedAt||row.withdrawnAt!==prior.withdrawnAt)errors.push({requestId:prior.id,reason:'Link/date mismatch'});}
 if(operation.newRequest){const row=requests.get(operation.newRequest.$id);if(!row||row.leadId!==operation.leadId||row.recordSource!=='lead_backfill'||row.acceptedAt!==null||row.dateSent!==`${getCurrentEasternIsoDate(new Date(operation.leadCreatedAt))}T00:00:00.000Z`)errors.push({leadId:operation.leadId,reason:'Imported row mismatch'});}
}
const skippedNI=new Set(plan.skipped.filter((s:any)=>s.reason==='Current status Not Interested').map((s:any)=>s.leadId));
const notInterestedHistory=history.filter((e:any)=>skippedNI.has(e.leadId)&&e.actorId==='system:linkedin-lead-repair');
if(notInterestedHistory.length)errors.push({reason:'Skipped Not Interested lead was processed'});
const counts=Object.fromEntries([...new Set<string>(history.map((e:any)=>e.eventType))].map(type=>[type,history.filter((e:any)=>e.eventType===type).length]));
const importedPresent=[...requests.values()].filter((r:any)=>r.recordSource==='lead_backfill').length;
const baselineArg=process.argv.find(arg=>arg.startsWith('--baseline-leads='));
let fullLeadComparison:null|Record<string,unknown>=null;
if(baselineArg){const baseline=JSON.parse(readFileSync(path.resolve(baselineArg.slice('--baseline-leads='.length)),'utf8'));
 const changed=baseline.filter((before:any)=>{const after=leads.get(before.$id);return !after||after.$updatedAt!==before.$updatedAt||after.ownerId!==before.ownerId||after.assignedToId!==before.assignedToId;}).map((r:any)=>r.$id);
 fullLeadComparison={baselineCount:baseline.length,currentCount:leads.size,changedOrMissingLeadIds:changed};
 if(changed.length)errors.push({reason:'Lead changed since original audit',leadIds:changed});}
const result={verifiedAt:new Date().toISOString(),pass:!errors.length,eligibleLeads:plan.operations.length,leadRevisionsUnchanged:plan.operations.length-errors.filter(e=>e.reason==='Lead metadata changed').length,
 existingRequestsLinked:counts.REQUEST_LINKED||0,historicalRowsPresent:importedPresent,remainingPlannedRowsCreated:plan.operations.filter((o:any)=>o.newRequest).length,
 skippedNotInterested:skippedNI.size,skippedNotInterestedHistoryRows:notInterestedHistory.length,registryRows:registry.length,historyRows:history.length,historyCounts:counts,fullLeadComparison,errors};
writeFileSync(path.join(dir,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(errors.length)process.exitCode=1;
