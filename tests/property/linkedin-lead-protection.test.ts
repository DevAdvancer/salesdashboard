import fc from 'fast-check';
import { isLeadReleased, leadOwnershipMayChange, leadProfileUrl } from '@/lib/utils/linkedin-lead-protection';
import { findProtectedLinkedinLead, withLinkedinProfileLock } from '@/lib/server/linkedin-lead-protection';
import { COLLECTIONS } from '@/lib/constants/appwrite';
import type { Databases } from 'node-appwrite';
jest.mock('node-appwrite',()=>({Query:{orderAsc:(key:string)=>`asc:${key}`,select:(keys:string[])=>`select:${keys}`,limit:(n:number)=>`limit:${n}`,cursorAfter:(id:string)=>`cursor:${id}`}}));

const statuses = ['Interested','Connection Accepted','Signed/Closure','Won','Generated','Not Interested','Backed Out','notinterested','backout'];
describe('LinkedIn lead protection invariants',() => {
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
