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
it('checks a new request under its profile lock and blocks a lead that appeared since preview', async () => {
  let locked = false;
  const raw = {
    getDocument: jest.fn().mockRejectedValue({ code: 404 }),
    listDocuments: jest.fn(async () => {
      expect(locked).toBe(true);
      return { total: 1, documents: [{ $id: 'racing-lead', data: '{"field_16":"https://linkedin.com/in/person"}', status: 'Interested' }] };
    }),
    createDocument: jest.fn(async (_db, collection, id, data) => {
      if (collection === COLLECTIONS.LINKEDIN_LEAD_REGISTRY) locked = true;
      return { $id: id, ...data };
    }),
    deleteDocument: jest.fn(async () => { locked = false; }),
  } as unknown as Databases;
  await expect(withLeadHistory(raw, async () => ({ id: 'agent', name: 'Agent' }))
    .createDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, 'request', { targetUrl: 'https://linkedin.com/in/person' }))
    .rejects.toThrow('protected lead');
  expect((raw.createDocument as jest.Mock).mock.calls.some(([, collection]) => collection === COLLECTIONS.LINKEDIN_REQUESTS)).toBe(false);
  expect((raw.createDocument as jest.Mock).mock.calls.some(([, collection, , data]) => collection === COLLECTIONS.LEAD_HISTORY && data.eventType === 'REQUEST_CHANGE_BLOCKED')).toBe(true);
  expect(locked).toBe(false);
});

it('writes server-owned actor and status history atomically with the lead and ignores forged history', async () => {
  const originalFlag = process.env.CRM_LEAD_HISTORY_SNAPSHOT;
  process.env.CRM_LEAD_HISTORY_SNAPSHOT = 'true';
  try {
    const previous = { id: 'old-event', actorId: 'old-agent', actorName: 'Old Agent', occurredAt: '2026-10-01T12:00:00Z', eventType: 'LEAD_CREATE', changes: {} };
    const before = { $id: 'lead', $updatedAt: 'before', $permissions: ['read("user:agent")', 'update("user:agent")'],
      status: 'Interested', ownerId: 'agent', data: '{"firstName":"Client"}', history: JSON.stringify([previous]) };
    const raw = { getDocument: jest.fn().mockResolvedValue(before),
      createDocument: jest.fn(async (_db, _collection, id, data) => ({ $id: id, ...data })),
      updateDocument: jest.fn(async (_db, _collection, _id, patch) => ({ ...before, ...patch, $updatedAt: 'after' })),
    } as unknown as Databases;
    const saved = await withLeadHistory(raw, async () => ({ id: 'real-agent', name: 'Real Agent' }))
      .updateDocument(DATABASE_ID, COLLECTIONS.LEADS, 'lead', { status: 'Backed Out', history: '[{"actorId":"forged"}]' });
    const history = JSON.parse(saved.history);
    expect(history[0]).toEqual(previous);
    expect(history[1]).toMatchObject({ actorId: 'real-agent', actorName: 'Real Agent', changes: { status: { from: 'Interested', to: 'Backed Out' } } });
    expect(history[1].changes).not.toHaveProperty('history');
    expect(raw.updateDocument).toHaveBeenCalledWith(DATABASE_ID, COLLECTIONS.LEADS, 'lead',
      expect.objectContaining({ status: 'Backed Out', history: expect.any(String) }), ['read("user:agent")']);
  } finally {
    if (originalFlag === undefined) delete process.env.CRM_LEAD_HISTORY_SNAPSHOT;
    else process.env.CRM_LEAD_HISTORY_SNAPSHOT = originalFlag;
  }
});
