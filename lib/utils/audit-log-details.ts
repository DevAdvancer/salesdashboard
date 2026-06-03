import type { AuditLog } from '@/lib/types';

export interface AuditDetailRow {
  label: string;
  value: string;
}

export interface AuditDetailChange {
  label: string;
  from: string;
  to: string;
}

export interface AuditLogDetailModel {
  badge: string;
  tone: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  rows: AuditDetailRow[];
  changes: AuditDetailChange[];
}

type MetadataValue = string | number | boolean | null | MetadataValue[] | { [key: string]: MetadataValue };
type MetadataRecord = Record<string, MetadataValue>;

const FIELD_LABELS: Record<string, string> = {
  assignedToId: 'Assigned To',
  branchId: 'Branch',
  candidateName: 'Candidate Name',
  closedAt: 'Closed At',
  company: 'Company',
  componentKey: 'Component',
  email: 'Email',
  fields: 'Fields',
  firstName: 'First Name',
  isClosed: 'Closed State',
  lastName: 'Last Name',
  leadId: 'Lead ID',
  leadName: 'Lead',
  name: 'Name',
  ownerId: 'Owner',
  phone: 'Contact Number',
  profileSelfUpdate: 'Profile Self Update',
  role: 'Role',
  section: 'Section',
  source: 'Source',
  status: 'Status',
};

function isRecord(value: unknown): value is MetadataRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMetadata(metadata?: string | null): MetadataRecord | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function humanizeKey(key: string): string {
  const explicit = FIELD_LABELS[key];
  if (explicit) {
    return explicit;
  }

  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeValue(value: MetadataValue | undefined, idToNameMap: Map<string, string>): string {
  if (value === undefined || value === null || value === '') {
    return 'N/A';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'string') {
    if (idToNameMap.has(value)) {
      return idToNameMap.get(value) ?? value;
    }

    if (/At$|Date|Time/i.test(value)) {
      return value;
    }

    if (/^https?:\/\//i.test(value) || (value.includes('@') && !value.includes(' '))) {
      return value;
    }

    return value
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  if (Array.isArray(value)) {
    return value.map((item) => humanizeValue(item, idToNameMap)).join(', ') || 'N/A';
  }

  return JSON.stringify(value);
}

function getChange(value: MetadataValue | undefined): { from: MetadataValue; to: MetadataValue } | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!('from' in value) || !('to' in value)) {
    return null;
  }

  return {
    from: value.from,
    to: value.to,
  };
}

function getLeadName(metadata: MetadataRecord, idToNameMap: Map<string, string>, log: AuditLog): string {
  const directName = metadata.leadName || metadata.candidateName || metadata.name;
  if (directName) {
    return humanizeValue(directName, idToNameMap);
  }

  const firstName = typeof metadata.firstName === 'string' ? metadata.firstName : '';
  const lastName = typeof metadata.lastName === 'string' ? metadata.lastName : '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) {
    return fullName;
  }

  return log.targetId ? (idToNameMap.get(log.targetId) ?? log.targetId) : 'N/A';
}

function actionBadge(action: string, metadata: MetadataRecord | null): AuditLogDetailModel['badge'] {
  if (action === 'SETTINGS_UPDATE') return 'Settings Updated';
  if (action === 'USER_UPDATE' && metadata?.profileSelfUpdate) return 'Profile Settings Updated';
  if (action === 'FORM_CONFIG_UPDATE') return 'Form Settings Updated';
  if (action === 'MOCK_EMAIL_SENT') return 'Mock Interview Email';
  if (action === 'INTERVIEW_EMAIL_SENT') return 'Interview Support Email';
  if (action === 'ASSESSMENT_EMAIL_SENT') return 'Assessment Support Email';
  if (action === 'LEAD_CREATE') return 'Lead Created';
  if (action === 'LEAD_DELETE') return 'Lead Deleted';
  if (action === 'LEAD_UPDATE' && metadata?.isClosed === true) return 'Lead Closed';
  if (action === 'LEAD_UPDATE' && metadata?.isClosed === false) return 'Lead Reopened';
  if (action === 'LEAD_UPDATE') return 'Lead Updated';
  if (action.includes('CREATE')) return 'Created';
  if (action.includes('DELETE')) return 'Deleted';
  if (action.includes('UPDATE')) return 'Updated';
  return action.replace(/_/g, ' ');
}

function actionTone(action: string): AuditLogDetailModel['tone'] {
  if (action.includes('DELETE')) return 'danger';
  if (action === 'FORM_CONFIG_UPDATE' || action === 'SETTINGS_UPDATE') return 'warning';
  if (action.includes('CREATE')) return 'success';
  if (action.includes('EMAIL')) return 'purple';
  if (action.includes('UPDATE')) return 'info';
  return 'default';
}

export function buildAuditLogDetailModel(
  log: AuditLog,
  idToNameMap: Map<string, string>
): AuditLogDetailModel {
  const metadata = parseMetadata(log.metadata);
  const model: AuditLogDetailModel = {
    badge: actionBadge(log.action, metadata),
    tone: actionTone(log.action),
    rows: [],
    changes: [],
  };

  if (!metadata) {
    model.rows.push({ label: 'Details', value: log.metadata || 'No details available.' });
    return model;
  }

  if (log.targetType.toUpperCase() === 'LEAD') {
    model.rows.push({ label: 'Lead', value: getLeadName(metadata, idToNameMap, log) });
  }

  if (log.action === 'USER_UPDATE' && metadata.profileSelfUpdate) {
    model.rows.push({ label: 'Section', value: humanizeValue(metadata.section ?? 'Profile Settings', idToNameMap) });
    const nameChange = isRecord(metadata.changes) ? getChange(metadata.changes.name) : null;
    if (nameChange) {
      model.rows.push({ label: 'Setting', value: 'Profile name' });
      model.rows.push({ label: 'Previous Value', value: humanizeValue(nameChange.from, idToNameMap) });
      model.rows.push({ label: 'New Value', value: humanizeValue(nameChange.to, idToNameMap) });
      model.changes.push({
        label: 'Name',
        from: humanizeValue(nameChange.from, idToNameMap),
        to: humanizeValue(nameChange.to, idToNameMap),
      });
    }
    return model;
  }

  if (log.action === 'SETTINGS_UPDATE') {
    ['section', 'componentKey', 'role'].forEach((key) => {
      if (metadata[key] !== undefined) {
        model.rows.push({ label: humanizeKey(key), value: humanizeValue(metadata[key], idToNameMap) });
      }
    });
    const allowedChange = getChange(metadata.allowed);
    if (allowedChange) {
      model.changes.push({
        label: 'Allowed',
        from: humanizeValue(allowedChange.from, idToNameMap),
        to: humanizeValue(allowedChange.to, idToNameMap),
      });
    }
    return model;
  }

  Object.entries(metadata).forEach(([key, value]) => {
    if (key === 'changes' || key === 'isCreation') {
      return;
    }

    const change = getChange(value);
    if (change) {
      model.changes.push({
        label: humanizeKey(key),
        from: humanizeValue(change.from, idToNameMap),
        to: humanizeValue(change.to, idToNameMap),
      });
      return;
    }

    if (key === 'leadName' || key === 'candidateName' || (log.targetType.toUpperCase() === 'LEAD' && key === 'leadId')) {
      return;
    }

    model.rows.push({
      label: humanizeKey(key),
      value: humanizeValue(value, idToNameMap),
    });
  });

  if (isRecord(metadata.changes)) {
    Object.entries(metadata.changes).forEach(([key, value]) => {
      const change = getChange(value);
      if (!change) {
        return;
      }
      model.changes.push({
        label: humanizeKey(key),
        from: humanizeValue(change.from, idToNameMap),
        to: humanizeValue(change.to, idToNameMap),
      });
    });
  }

  return model;
}
