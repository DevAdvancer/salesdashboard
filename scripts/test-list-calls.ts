import { listCallRequestsAction } from '../app/actions/call-requests';
import { getAuthenticatedUserDoc } from '../lib/server/current-user';

// Mock getAuthenticatedUserDoc to return an admin
jest.mock('../lib/server/current-user', () => ({
  getAuthenticatedUserDoc: jest.fn().mockResolvedValue({
    $id: '123',
    name: 'Admin',
    role: 'admin',
    department: 'resume'
  })
}));

async function main() {
  const result = await listCallRequestsAction();
  console.log(`Returned ${result.length} call requests:`);
  result.forEach(r => console.log(`${r.$id}: ${r.status}`));
}

main().catch(console.error);
