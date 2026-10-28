export type HandoffUser = {
  $id: string; name: string; role: string; department?: string; isActive?: boolean;
  teamLeadId?: string | null;
};

export function canDeactivateUser(actor: HandoffUser, target: HandoffUser) {
  if (actor.isActive === false || actor.$id === target.$id) return false;
  if (!['agent', 'lead_generation', 'monitor', 'operations'].includes(target.role)) return false;
  if (['admin', 'developer'].includes(actor.role)) return true;
  if ((actor.department || 'sales') !== (target.department || 'sales')) return false;
  return actor.role === 'team_lead' ? target.teamLeadId === actor.$id : actor.role === 'senior_tl';
}

export function canReceiveDeactivationHandoff(actor: HandoffUser, source: HandoffUser, recipient: HandoffUser) {
  if (!canDeactivateUser(actor, source) || recipient.$id === source.$id || recipient.isActive === false) return false;
  if ((source.department || 'sales') !== 'sales' || (recipient.department || 'sales') !== 'sales') return false;
  if (!['agent', 'team_lead', 'senior_tl', 'admin', 'developer'].includes(recipient.role)) return false;
  if (['admin', 'developer'].includes(actor.role)) return true;
  return actor.role === 'senior_tl' || recipient.$id === actor.$id || recipient.teamLeadId === actor.$id;
}
