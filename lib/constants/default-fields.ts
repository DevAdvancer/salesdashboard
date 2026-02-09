export type FieldType = 'text' | 'email' | 'phone' | 'dropdown' | 'textarea' | 'checklist';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  key: string; // JSON key for storage
  required: boolean;
  visible: boolean;
  order: number;
  options?: string[]; // For dropdown/checklist
  placeholder?: string;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
  };
}

export const DEFAULT_FIELDS: FormField[] = [
  {
    id: '1',
    type: 'text',
    label: 'First Name',
    key: 'firstName',
    required: true,
    visible: true,
    order: 1
  },
  {
    id: '2',
    type: 'text',
    label: 'Last Name',
    key: 'lastName',
    required: true,
    visible: true,
    order: 2
  },
  {
    id: '3',
    type: 'email',
    label: 'Email',
    key: 'email',
    required: true,
    visible: true,
    order: 3
  },
  {
    id: '4',
    type: 'phone',
    label: 'Phone',
    key: 'phone',
    required: false,
    visible: true,
    order: 4
  },
  {
    id: '5',
    type: 'text',
    label: 'Company',
    key: 'company',
    required: false,
    visible: true,
    order: 5
  },
  {
    id: '6',
    type: 'dropdown',
    label: 'Source',
    key: 'source',
    required: false,
    visible: true,
    order: 6,
    options: ['Website', 'Referral', 'Cold Call', 'Social Media']
  },
  {
    id: '7',
    type: 'dropdown',
    label: 'Status',
    key: 'status',
    required: true,
    visible: true,
    order: 7,
    options: ['New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation']
  },
  {
    id: '8',
    type: 'text',
    label: 'Owner',
    key: 'ownerId',
    required: true,
    visible: false,
    order: 8
  },
  {
    id: '9',
    type: 'text',
    label: 'Assigned To',
    key: 'assignedToId',
    required: false,
    visible: true,
    order: 9
  },
  {
    id: '10',
    type: 'text',
    label: 'Legal Name',
    key: 'legalName',
    required: false,
    visible: true,
    order: 10
  },
  {
    id: '11',
    type: 'text',
    label: 'SSN (Last 4)',
    key: 'ssnLast4',
    required: false,
    visible: true,
    order: 11,
    validation: { pattern: '^\\d{4}$', minLength: 4, maxLength: 4 }
  },
  {
    id: '12',
    type: 'dropdown',
    label: 'Visa Status',
    key: 'visaStatus',
    required: false,
    visible: true,
    order: 12,
    options: ['Citizen', 'Green Card', 'H1B', 'F1', 'Other']
  },
  {
    id: '13',
    type: 'textarea',
    label: 'Notes',
    key: 'notes',
    required: false,
    visible: true,
    order: 13
  },
];
