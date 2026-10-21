import { withLeadHistory,leadHistoryChanges } from '@/lib/server/lead-history';
import { COLLECTIONS,DATABASE_ID } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';
jest.mock('node-appwrite',()=>({ID:{unique:()=>`event-${Math.random()}`},Query:{orderAsc:(key:string)=>`asc:${key}`,select:(keys:string[])=>`select:${keys}`,limit:(n:number)=>`limit:${n}`}}));

it('redacts sensitive values and preserves owner/assignee changes separately',()=>{
  const changes=leadHistoryChanges({ownerId:'old',assignedToId:'tl',data:'{"ssnLast4":"1234","status":"Interested"}'},
    {ownerId:'new',assignedToId:'new-tl',data:'{"ssnLast4":"5678","status":"Backed Out"}'});
  expect(changes.ownerId).toEqual({from:'old',to:'new'});
  expect(changes.assignedToId).toEqual({from:'tl',to:'new-tl'});
  expect(JSON.stringify(changes)).not.toMatch(/1234|5678/);
});

it('persists an intent before a write and appends success without altering prior events',async()=>{
  const calls:string[]=[];const events:any[]=[];
  const before={$id:'request',leadId:null,targetUrl:'not-a-profile',status:'sent',$updatedAt:'before'};
  const raw={getDocument:jest.fn().mockResolvedValue(before),
    createDocument:jest.fn(async(_db,collection,_id,data)=>{calls.push(collection);events.push(data);return {$id:'event'};}),
    updateDocument:jest.fn(async()=>{calls.push('update');return {...before,status:'withdrawn',$updatedAt:'after'};})} as unknown as Databases;
  const db=withLeadHistory(raw,async()=>({id:'agent',name:'Agent'}));
  await db.updateDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,'request',{status:'withdrawn'});
  expect(calls).toEqual([COLLECTIONS.LEAD_HISTORY,'update',COLLECTIONS.LEAD_HISTORY]);
  expect(events.map(e=>e.eventType)).toEqual(['REQUEST_UPDATE_ATTEMPT','REQUEST_UPDATE']);
  expect(events[0].actorId).toBe('agent');
});

it('does not perform an untracked mutation when the history store is unavailable',async()=>{
  const raw={getDocument:jest.fn().mockResolvedValue({$id:'request',targetUrl:'invalid',status:'sent'}),
    createDocument:jest.fn().mockRejectedValue(new Error('history offline')),updateDocument:jest.fn()} as unknown as Databases;
  await expect(withLeadHistory(raw,async()=>({id:'agent',name:'Agent'})).updateDocument(DATABASE_ID,COLLECTIONS.LINKEDIN_REQUESTS,'request',{status:'withdrawn'})).rejects.toThrow('history offline');
  expect(raw.updateDocument).not.toHaveBeenCalled();
});
