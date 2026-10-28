import fc from 'fast-check';
import { canDeactivateUser, canReceiveDeactivationHandoff, type HandoffUser } from '@/lib/utils/user-deactivation';

const tl: HandoffUser = { $id: 'tl', name: 'TL', role: 'team_lead', department: 'sales', isActive: true };
const source: HandoffUser = { $id: 'source', name: 'Source', role: 'agent', teamLeadId: 'tl', department: 'sales', isActive: true };

it('keeps TL deactivation and recipients inside their active Sales team, including self', () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), (active, sameDepartment, sameTeam, self) => {
    const recipient = { $id: self ? 'tl' : 'recipient', name: 'Recipient', role: self ? 'team_lead' : 'agent',
      isActive: active, department: sameDepartment ? 'sales' : 'resume', teamLeadId: sameTeam ? 'tl' : 'other' };
    expect(canReceiveDeactivationHandoff(tl, source, recipient)).toBe(active && sameDepartment && (self || sameTeam));
    expect(canDeactivateUser(tl, { ...source, teamLeadId: sameTeam ? 'tl' : 'other', department: sameDepartment ? 'sales' : 'resume' })).toBe(sameTeam && sameDepartment);
  }));
});

it('rejects inactive actors, self-deactivation, the source as recipient and non-Sales recipients for every privileged role', () => {
  fc.assert(fc.property(fc.constantFrom('admin', 'developer', 'senior_tl', 'team_lead'), fc.constantFrom('monitor', 'operations', 'lead_generation', 'compliance'), (role, recipientRole) => {
    const actor = { ...tl, role };
    expect(canDeactivateUser({ ...actor, isActive: false }, source)).toBe(false);
    expect(canDeactivateUser(actor, { ...source, $id: actor.$id })).toBe(false);
    expect(canReceiveDeactivationHandoff(actor, source, { ...source, role: 'agent' })).toBe(false);
    expect(canReceiveDeactivationHandoff(actor, source, { ...tl, role: recipientRole })).toBe(false);
    expect(canReceiveDeactivationHandoff(actor, source, { ...tl, department: 'resume' })).toBe(false);
  }));
});
