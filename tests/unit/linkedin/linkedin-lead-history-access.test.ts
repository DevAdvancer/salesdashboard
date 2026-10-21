jest.mock('node-appwrite',()=>({Query:{or:jest.fn(q=>q),equal:jest.fn((k,v)=>({k,v})),orderDesc:jest.fn(k=>k),limit:jest.fn(n=>n),cursorAfter:jest.fn(id=>id)}}));
jest.mock('@/lib/server/appwrite',()=>({createAdminClient:jest.fn()}));
jest.mock('@/lib/server/current-user',()=>({getAuthenticatedUserDoc:jest.fn()}));
jest.mock('@/app/actions/lead/queries',()=>({getLeadAction:jest.fn()}));
import { getLinkedinLeadHistoryAction } from '@/app/actions/linkedin/lead-history';
import { createAdminClient } from '@/lib/server/appwrite';
import { getAuthenticatedUserDoc } from '@/lib/server/current-user';
import { getLeadAction } from '@/app/actions/lead/queries';
import { COLLECTIONS } from '@/lib/constants/appwrite';

beforeEach(()=>jest.clearAllMocks());
it('uses existing lead visibility before reading any history',async()=>{
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({$id:'other-agent',department:'sales',isActive:true});
  (getLeadAction as jest.Mock).mockRejectedValue(new Error('Permission denied'));
  await expect(getLinkedinLeadHistoryAction({leadId:'foreign-lead'})).rejects.toThrow('Permission denied');
  expect(createAdminClient).not.toHaveBeenCalled();
});
it.each([{department:'resume',isActive:true},{department:'sales',isActive:false}])('rejects an ineligible viewer before any lead read',async override=>{
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({$id:'agent',...override});
  await expect(getLinkedinLeadHistoryAction({leadId:'lead'})).rejects.toThrow('Unauthorized');
  expect(getLeadAction).not.toHaveBeenCalled();
});
it('queries append-only events for the authorized lead and supports older pages',async()=>{
  (getAuthenticatedUserDoc as jest.Mock).mockResolvedValue({$id:'agent',department:'sales'});
  (getLeadAction as jest.Mock).mockResolvedValue({$id:'lead',data:'{"linkedinProfileUrl":"https://linkedin.com/in/person"}'});
  const db={clearReadCacheForCollection:jest.fn(),listDocuments:jest.fn().mockResolvedValue({documents:[{$id:'event'}]})};
  (createAdminClient as jest.Mock).mockResolvedValue({databases:db});
  expect(await getLinkedinLeadHistoryAction({leadId:'lead',before:'older'})).toEqual({rows:[{$id:'event'}],next:null});
  expect(getLeadAction).toHaveBeenCalledWith('lead','agent');
  expect(db.listDocuments).toHaveBeenCalledWith(expect.any(String),COLLECTIONS.LEAD_HISTORY,expect.arrayContaining(['older']));
});
