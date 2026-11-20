jest.mock('node-appwrite',()=>({ID:{unique:()=> 'id'},Query:{greaterThanEqual:jest.fn(),lessThan:jest.fn(),lessThanEqual:jest.fn(),orderAsc:jest.fn(),equal:jest.fn(),limit:jest.fn()}}));
jest.mock('@/lib/server/appwrite',()=>({createAdminClient:jest.fn()}));
jest.mock('@/lib/server/appwrite-pagination',()=>({listAllDocuments:jest.fn()}));
import { listAllDocuments } from '@/lib/server/appwrite-pagination';
import { createAdminClient } from '@/lib/server/appwrite';
import { listLinkedinReportRequests } from '@/lib/server/linkedin-report-requests';
import { computeLinkedinStatsForDate } from '@/lib/server/stats-aggregator';

it('does not count historical lead-link rows as newly sent or accepted invitations',async()=>{
  const real={$id:'real',agentId:'agent',accountId:'real-account',status:'sent',$createdAt:'2026-10-21T14:00:00Z'};
  const imported={...real,$id:'import',status:'accepted',accountId:'lead_history_import',recordSource:'lead_backfill'};
  (listAllDocuments as jest.Mock).mockResolvedValue([real,imported]);
  const db={};(createAdminClient as jest.Mock).mockResolvedValue({databases:db});
  expect(await listLinkedinReportRequests({databases:db as never,startDate:'2026-10-21',endDate:'2026-10-21'})).toEqual([real]);
  expect(await computeLinkedinStatsForDate('2026-10-21',new Map())).toEqual([expect.objectContaining({accountId:'real-account',sent:1,accepted:0})]);
});

it('refreshes each agent and account when other CRM instances record additional requests', async () => {
  const first = { $id: 'first', agentId: 'agent-a', accountId: 'account-a', status: 'sent',
    $createdAt: '2026-11-20T14:00:00Z' };
  const second = { ...first, $id: 'second', agentId: 'agent-b', accountId: 'account-b' };
  const initial = [first, second];
  const fresh = { listDocuments: jest.fn().mockResolvedValue({ documents: initial }) };
  const db = { uncachedReads: fresh, listDocuments: jest.fn().mockResolvedValue({ documents: initial }) };
  (createAdminClient as jest.Mock).mockResolvedValue({ databases: db });
  (listAllDocuments as jest.Mock).mockImplementation(async ({ databases }) =>
    (await databases.listDocuments()).documents);
  const day = '2026-11-20';
  const report = { databases: db as never, startDate: day, endDate: day };

  expect(await listLinkedinReportRequests(report)).toEqual(initial);
  expect(await computeLinkedinStatsForDate(day, new Map())).toEqual([
    expect.objectContaining({ agentId: 'agent-a', accountId: 'account-a', sent: 1 }),
    expect.objectContaining({ agentId: 'agent-b', accountId: 'account-b', sent: 1 }),
  ]);

  const updated = [...initial, { ...first, $id: 'third' }, { ...second, $id: 'fourth' },
    { ...second, $id: 'fifth' }];
  fresh.listDocuments.mockResolvedValue({ documents: updated });
  expect(await listLinkedinReportRequests(report)).toEqual(updated);
  expect(await computeLinkedinStatsForDate(day, new Map())).toEqual([
    expect.objectContaining({ agentId: 'agent-a', accountId: 'account-a', sent: 2 }),
    expect.objectContaining({ agentId: 'agent-b', accountId: 'account-b', sent: 3 }),
  ]);
  expect(db.listDocuments).not.toHaveBeenCalled();
});
