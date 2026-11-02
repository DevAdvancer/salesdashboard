import fc from 'fast-check';
import { canSeeProgress, canManageProgress, canManageMarketingTl, canSaveFinalFeedback, progressHierarchyIds, PROGRESS_ROLES } from '@/lib/client-progress';
import { COMPONENT_ACCESS } from '@/lib/constants/component-access';
import { DEFAULT_ACCESS_RULES } from '@/lib/constants/default-access';

const actor = ($id: string, role: typeof PROGRESS_ROLES[number], department = 'sales') => ({ $id, role, department, isActive: true });
const entry = (salespersonId: string, department = 'sales') => ({ salespersonId, department, eligible: true, progressStatus: 'New' as const });

test('agents never inherit access from a name, other owner or another department', () => {
  fc.assert(fc.property(fc.uuid(), fc.uuid(), fc.constantFrom('sales', 'resume'), (viewer, owner, department) => {
    expect(canSeeProgress(actor(viewer, 'agent', department), entry(owner, department), [viewer])).toBe(viewer === owner);
    expect(canSeeProgress(actor(viewer, 'agent', department), entry(viewer, department === 'sales' ? 'resume' : 'sales'), [viewer])).toBe(false);
  }));
});

test('every role excludes backed-out and not-interested entries, inactive accounts and ineligible sources', () => {
  fc.assert(fc.property(fc.constantFrom(...PROGRESS_ROLES), fc.constantFrom('Backed Out', 'Backout', 'BACKED OUT', 'Not Interested', 'not_interested'), (role, progressStatus) => {
    expect(canSeeProgress(actor('user', role), { ...entry('user'), progressStatus }, ['user'])).toBe(false);
    expect(canSeeProgress(actor('user', role), { ...entry('user'), eligible: false }, ['user'])).toBe(false);
    expect(canSeeProgress({ ...actor('user', role), isActive: false }, entry('user'), ['user'])).toBe(false);
  }));
});

test('only Admin can manage assignments/recruiters and amend already-saved final feedback', () => {
  fc.assert(fc.property(fc.constantFrom(...PROGRESS_ROLES), fc.constantFrom('sales', 'resume'), (role, department) => {
    const viewer = actor('user', role, department);
    expect(canManageProgress(viewer)).toBe(role === 'admin');
    expect(canManageMarketingTl(viewer)).toBe(role === 'admin' && department === 'sales');
    expect(canSaveFinalFeedback(viewer, true)).toBe(role === 'admin');
  }));
});

test('hierarchy follows legacy and array parents, handles cycles, and never crosses departments', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 25 }), fc.constantFrom('teamLeadId', 'managerId', 'teamLeadIds', 'managerIds', 'assistantManagerIds'), (depth, field) => {
    const rows = Array.from({ length: depth }, (_, index) => ({ $id: `user${index + 1}`, department: 'sales', [field]: field.endsWith('Ids') ? [`user${index}`] : `user${index}` }));
    rows.push({ $id: 'other-department', department: 'resume', [field]: field.endsWith('Ids') ? ['user0'] : 'user0' });
    const ids = progressHierarchyIds(actor('user0', 'team_lead'), rows);
    expect(ids).toHaveLength(depth + 1);
    expect(ids).not.toContain('other-department');
    expect(progressHierarchyIds(actor('user0', 'agent'), rows)).toEqual(['user0']);
  }));
});

test('the route defaults cover every role consistently', () => {
  fc.assert(fc.property(fc.constantFrom(...PROGRESS_ROLES), role => {
    expect(COMPONENT_ACCESS['client-progress']).toContain(role);
    expect(DEFAULT_ACCESS_RULES).toContainEqual({ componentKey: 'client-progress', role, allowed: true });
  }));
});
