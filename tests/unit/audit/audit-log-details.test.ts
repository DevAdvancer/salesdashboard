import { buildAuditLogDetailModel } from '@/lib/utils/audit-log-details';
import type { AuditLog } from '@/lib/types';

function makeLog(overrides: Partial<AuditLog>): AuditLog {
  return {
    $id: 'audit_1',
    action: 'USER_UPDATE',
    actorId: 'user_1',
    actorName: 'TeamLead One',
    targetId: 'target_1',
    targetType: 'user',
    metadata: undefined,
    performedAt: '2026-05-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildAuditLogDetailModel', () => {
  it('formats profile setting name changes with old and new values', () => {
    const model = buildAuditLogDetailModel(
      makeLog({
        action: 'USER_UPDATE',
        targetType: 'user',
        metadata: JSON.stringify({
          profileSelfUpdate: true,
          section: 'Profile Settings',
          changes: {
            name: { from: 'Old Name', to: 'New Name' },
          },
        }),
      }),
      new Map()
    );

    expect(model.badge).toBe('Profile Settings Updated');
    expect(model.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Setting', value: 'Profile name' }),
        expect.objectContaining({ label: 'Previous Value', value: 'Old Name' }),
        expect.objectContaining({ label: 'New Value', value: 'New Name' }),
      ])
    );
  });

  it('formats lead changes with a readable lead name and field changes', () => {
    const model = buildAuditLogDetailModel(
      makeLog({
        action: 'LEAD_UPDATE',
        targetId: 'lead_1',
        targetType: 'LEAD',
        metadata: JSON.stringify({
          leadName: 'Mina Patel',
          status: { from: 'New', to: 'Pipeline' },
          assignedToId: 'agent_1',
        }),
      }),
      new Map([
        ['agent_1', 'Alex Agent'],
      ])
    );

    expect(model.badge).toBe('Lead Updated');
    expect(model.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Lead', value: 'Mina Patel' }),
        expect.objectContaining({ label: 'Assigned To', value: 'Alex Agent' }),
      ])
    );
    expect(model.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Status', from: 'New', to: 'Pipeline' }),
      ])
    );
  });

  it('formats access setting changes', () => {
    const model = buildAuditLogDetailModel(
      makeLog({
        action: 'SETTINGS_UPDATE',
        targetType: 'settings',
        metadata: JSON.stringify({
          section: 'Access Control',
          componentKey: 'reports',
          role: 'team_lead',
          allowed: { from: false, to: true },
        }),
      }),
      new Map()
    );

    expect(model.badge).toBe('Settings Updated');
    expect(model.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Section', value: 'Access Control' }),
        expect.objectContaining({ label: 'Component', value: 'Reports' }),
        expect.objectContaining({ label: 'Role', value: 'Team Lead' }),
      ])
    );
    expect(model.changes[0]).toMatchObject({
      label: 'Allowed',
      from: 'No',
      to: 'Yes',
    });
  });
});
