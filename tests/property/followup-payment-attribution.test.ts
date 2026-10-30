import fc from 'fast-check';
import { followupPaymentRecipient } from '@/lib/utils/followup-payment-attribution';
import { buildTargetReport } from '@/lib/utils/monthly-target-report';
import type { MonthlyTarget, User } from '@/lib/types';

const distinctIds = fc.uniqueArray(fc.stringMatching(/^[a-z]{2,12}$/), { minLength: 3, maxLength: 3 });

test('changing the recorder cannot move a linked followup away from its assigned profile', () => {
  fc.assert(fc.property(distinctIds, ([assigned, recorder, owner]) => {
    const lead = { assignedToId: assigned, ownerId: owner };
    expect(followupPaymentRecipient({ leadId: 'client', createdById: recorder }, lead)).toBe(assigned);
    expect(followupPaymentRecipient({ leadId: 'client', createdById: owner }, lead)).toBe(assigned);
  }));
});

test('saved explicit credit stays stable across recording and lead reassignment, including BGC', () => {
  fc.assert(fc.property(distinctIds, fc.constantFrom('client', 'manual_followup:bgc:profile'), ([credited, recorder, assigned], leadId) => {
    expect(followupPaymentRecipient({ leadId, createdById: recorder, creditedAgentId: credited },
      { assignedToId: assigned })).toBe(credited);
  }));
});

test('manual revenue stays visible with or without a team target split and never invents an agent target', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), fc.boolean(), (amount, hasTeam) => {
    const user = { $id: 'profile', name: 'Profile', role: 'agent', teamLeadId: hasTeam ? 'tl' : null } as User;
    const tl = { $id: 'tl', name: 'TL', role: 'team_lead' } as User;
    const report = buildTargetReport({ monthKey: '2026-10',
      targets: hasTeam ? [{ $id: 'target', teamLeadId: 'tl', totalAmount: 1000 } as MonthlyTarget] : [],
      assignmentsByTargetId: {}, usersByAgentId: new Map([['profile', user], ['tl', tl]]),
      agentStatsByUserId: {}, followupsByAgentId: { profile: amount },
    });
    const profile = report.rows.flatMap(row => row.agents).filter(agent => agent.userId === 'profile');
    expect(profile).toHaveLength(1);
    expect(profile[0]).toMatchObject({ target: 0, achieved: amount, followupsAmount: amount });
    expect(report.totals).toMatchObject({ target: hasTeam ? 1000 : 0, achieved: amount });
  }));
});
