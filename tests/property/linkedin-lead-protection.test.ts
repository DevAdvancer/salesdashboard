import fc from 'fast-check';
import { isLeadReleased, leadOwnershipMayChange, leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { findProtectedLinkedinLead, invalidateLinkedinLeadPreviews, withLinkedinProfileLock } from '@/lib/server/linkedin-lead-protection';
import { COLLECTIONS, DATABASE_ID } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';
import { withLeadHistory } from '@/lib/server/lead-history';
jest.mock('node-appwrite',()=>({ID:{unique:()=>`event-${Math.random()}`},Query:{orderAsc:(key:string)=>`asc:${key}`,select:(keys:string[])=>`select:${keys}`,limit:(n:number)=>`limit:${n}`,cursorAfter:(id:string)=>`cursor:${id}`}}));

const statuses = ['Interested','Connection Accepted','Signed/Closure','Won','Generated','Not Interested','Backed Out','notinterested','backout'];
describe('LinkedIn lead protection invariants',() => {
  beforeEach(() => invalidateLinkedinLeadPreviews());
  it('checks same-agent resends under the lock even when an earlier preview found no lead', async () => {
    await fc.assert(fc.asyncProperty(fc.constantFrom('Interested', 'Signed/Closure', 'Generated'), fc.uuid(), async (status, agentId) => {
      invalidateLinkedinLeadPreviews();
      let locked = false;
      const before = { $id: 'request', targetUrl: 'https://linkedin.com/in/person', status: 'withdrawn', agentId, accountId: 'account', dateSent: '2026-10-21' };
      const db = {
        getDocument: jest.fn(async (_database, collection) => { if (collection === COLLECTIONS.LINKEDIN_REQUESTS) return before; throw { code: 404 }; }),
        listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }),
        createDocument: jest.fn(async (_database, collection, id, data) => {
          if (collection === COLLECTIONS.LINKEDIN_LEAD_REGISTRY) locked = true;
          return { $id: id, ...data };
        }),
        updateDocument: jest.fn(), deleteDocument: jest.fn(async () => { locked = false; }),
      } as unknown as Databases;
      await findProtectedLinkedinLead(db, before.targetUrl, undefined, { preview: true });
      (db.listDocuments as jest.Mock).mockImplementation(async () => {
        expect(locked).toBe(true);
        return { total: 1, documents: [{ $id: 'lead', status, data: JSON.stringify({ field_16: before.targetUrl }) }] };
      });
      await expect(withLeadHistory(db, async () => ({ id: agentId, name: 'Agent' }))
        .updateDocument(DATABASE_ID, COLLECTIONS.LINKEDIN_REQUESTS, 'request', { status: 'sent', dateSent: '2026-10-22', agentId }))
        .rejects.toThrow('protected lead');
      expect(db.updateDocument).not.toHaveBeenCalled();
      expect(locked).toBe(false);
    }), { numRuns: 10 });
  });
  it('shares one preview scan across profiles but every authoritative check reads fresh state', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 30 }), fc.constantFrom(...statuses), async (count, status) => {
      invalidateLinkedinLeadPreviews();
      const db = { getDocument: jest.fn().mockRejectedValue({ code: 404 }), clearReadCacheForCollection: jest.fn(),
        listDocuments: jest.fn().mockResolvedValue({ total: 0, documents: [] }) } as unknown as Databases;
      await Promise.all(Array.from({ length: count }, (_, i) =>
        findProtectedLinkedinLead(db, `https://linkedin.com/in/person-${i}`, undefined, { preview: true })));
      expect(db.listDocuments).toHaveBeenCalledTimes(1);
      const lead = { $id: 'new', data: JSON.stringify({ field_16: 'https://linkedin.com/in/person-0' }), status };
      (db.listDocuments as jest.Mock).mockResolvedValue({ total: 1, documents: [lead] });
      expect(Boolean(await findProtectedLinkedinLead(db, 'https://linkedin.com/in/person-0'))).toBe(!isLeadReleased(status));
      expect(db.listDocuments).toHaveBeenCalledTimes(2);
      invalidateLinkedinLeadPreviews();
      expect(Boolean(await findProtectedLinkedinLead(db, 'https://linkedin.com/in/person-0', undefined, { preview: true }))).toBe(!isLeadReleased(status));
      expect(db.listDocuments).toHaveBeenCalledTimes(3);
    }), { numRuns: 15 });
  });
  it('blocks ownership takeover for every protected status regardless of actor or company',() => {
    fc.assert(fc.property(fc.constantFrom(...statuses),fc.uuid(),fc.uuid(),fc.string(),(status,owner,nextOwner,company) => {
      fc.pre(owner!==nextOwner);
      expect(leadOwnershipMayChange({status,ownerId:owner},{ownerId:nextOwner,company})).toBe(isLeadReleased(status));
    }));
  });
  it('resolves all current and legacy profile fields across URL variants',() => {
    fc.assert(fc.property(fc.integer({min:1,max:999999}),fc.constantFrom('linkedinProfileUrl','linkedinProfile','field_16'),(id,key) => {
      expect(leadProfileUrl(JSON.stringify({[key]:` https://linkedin.com/in/PERSON-${id}/?trk=ignored `}))).toBe(`https://www.linkedin.com/in/person-${id}`);
    }));
  });
  it('uses live lead status rather than request company/withdrawal or age',async() => {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...statuses),fc.string(),async(status,company) => {
      const lead={$id:'old-lead',data:JSON.stringify({field_16:'https://linkedin.com/in/person'}),status,company,$createdAt:'2020-01-01'};
      const db={ getDocument:jest.fn().mockRejectedValue({code:404}),listDocuments:jest.fn().mockResolvedValue({documents:[lead]}) } as unknown as Databases;
      expect(Boolean(await findProtectedLinkedinLead(db,'https://www.linkedin.com/in/person/'))).toBe(!isLeadReleased(status));
    }),{numRuns:30});
  });
  it('never treats a failed scan as an available profile',async() => {
    const db={getDocument:jest.fn().mockRejectedValue({code:404}),listDocuments:jest.fn().mockRejectedValue(new Error('offline'))} as unknown as Databases;
    await expect(findProtectedLinkedinLead(db,'https://linkedin.com/in/person')).rejects.toThrow('offline');
  });
  it('finds legacy profiles anywhere in a large batch, including beyond the old 1,000-row boundary', async () => {
    await fc.assert(fc.asyncProperty(fc.integer({ min: 1001, max: 1900 }),
      fc.constantFrom('linkedinProfileUrl', 'linkedinProfile', 'field_16'), fc.constantFrom(...statuses), async (position, key, status) => {
        const leads = Array.from({ length: position }, (_, i) => ({ $id: `other-${i}`, data: '{}', status: 'Interested' }));
        leads.push({ $id: 'target', data: JSON.stringify({ [key]: 'https://linkedin.com/in/PERSON/?trk=test' }), status });
        const db = { getDocument: jest.fn().mockRejectedValue({ code: 404 }),
          listDocuments: jest.fn().mockResolvedValue({ total: leads.length, documents: leads }) } as unknown as Databases;
        expect(Boolean(await findProtectedLinkedinLead(db, 'https://www.linkedin.com/in/person'))).toBe(!isLeadReleased(status));
        expect(db.listDocuments).toHaveBeenCalledTimes(1);
        expect((db.listDocuments as jest.Mock).mock.calls[0][2]).toContain('limit:5000');
      }), { numRuns: 20 });
  });
  it('serializes concurrent profile writes with a database reservation',async() => {
    const locks=new Set<string>();let release!:()=>void;
    const hold=new Promise<void>(resolve=>{release=resolve;});
    const db={createDocument:jest.fn(async(_db,_collection,id)=>{if(locks.has(id))throw {code:409};locks.add(id);return {$id:id};}),
      deleteDocument:jest.fn(async(_db,collection,id)=>{expect(collection).toBe(COLLECTIONS.LINKEDIN_LEAD_REGISTRY);locks.delete(id);})} as unknown as Databases;
    const first=withLinkedinProfileLock(db,'https://www.linkedin.com/in/person','lead-1',async()=>{await hold;return 'saved';});
    await expect(withLinkedinProfileLock(db,'https://www.linkedin.com/in/person','lead-2',async()=>'duplicate')).rejects.toThrow('being updated');
    release();await expect(first).resolves.toBe('saved');expect(locks.size).toBe(0);
  });
});
