import type { ExtensionCheck } from 'crm-shared/types/linkedin-extension';

export function profileStatusLabel(check: ExtensionCheck): string {
  switch (check.state) {
    case 'new': return check.knownToCrm ? 'Present · Available' : 'Available';
    case 'existing_lead': return 'Present in CRM';
    case 'active_request': return 'Already sent';
    case 'resend_available': return 'Resend available';
    case 'limit_reached': return 'Limit reached';
    case 'missing_limit': return 'Limit not set';
  }
}
