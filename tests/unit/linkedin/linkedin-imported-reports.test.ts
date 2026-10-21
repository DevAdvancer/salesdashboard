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
