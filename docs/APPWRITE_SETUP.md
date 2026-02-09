# Appwrite Database Configuration

This document provides detailed information about the Appwrite database structure for SalesHub CRM.

## Database Overview

**Database ID**: `crm-database-1`

The database consists of four collections that work together to provide a flexible, manager-controlled CRM system.

## Collections

### 1. users Collection

**Purpose**: Store user accounts with role-based hierarchy

**Collection ID**: `users`

**Attributes**:

| Attribute | Type | Required | Size | Default | Description |
|-----------|------|----------|------|---------|-------------|
| name | string | Yes | 255 | - | User's full name |
| email | email | Yes | 255 | - | User's email address (unique) |
| role | enum | Yes | - | - | User role: 'manager' or 'agent' |
| managerId | string | No | 255 | null | ID of the manager who created this agent |

**Indexes**:
- `email_idx` (unique): Fast lookup by email
- `role_idx` (key): Filter users by role
- `manager_idx` (key): Find all agents for a manager

**Permissions**:
- Read: Any authenticated user (to see user names in dropdowns)
- Create: Any authenticated user (for signup)
- Update: User (own document) + Manager (their agents)
- Delete: Manager (their agents only)

**Business Rules**:
- Users created through signup get role='manager' and managerId=null
- Users created through User Management get role='agent' and managerId=creatingManager.$id
- Agents can only be created by managers
- Managers cannot have a managerId

---

### 2. leads Collection

**Purpose**: Store lead data with dynamic schema support

**Collection ID**: `leads`

**Attributes**:

| Attribute | Type | Required | Size | Default | Description |
|-----------|------|----------|------|---------|-------------|
| data | string | Yes | 65535 | - | JSON serialized lead data (dynamic fields) |
| status | string | Yes | 50 | - | Current lead status |
| ownerId | string | Yes | 255 | - | Manager who owns this lead |
| assignedToId | string | No | 255 | null | Agent assigned to work on this lead |
| isClosed | boolean | Yes | - | false | Whether lead is closed |
| closedAt | datetime | No | - | null | When the lead was closed |

**Indexes**:
- `owner_idx` (key): Find all leads owned by a manager
- `assigned_idx` (key): Find all leads assigned to an agent
- `status_idx` (key): Filter leads by status
- `closed_idx` (key): Separate active and closed leads

**Permissions** (Document-level, set dynamically):
- Read: [ownerId, assignedToId]
- Update: [ownerId] + [assignedToId] (if not closed)
- Delete: [ownerId]

**Data Field Structure**:
The `data` field contains JSON with dynamic fields based on form configuration:
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+1234567890",
  "company": "Acme Corp",
  "source": "Website",
  "status": "New",
  "legalName": "John Michael Doe",
  "ssnLast4": "1234",
  "visaStatus": "Citizen",
  "notes": "Interested in enterprise plan"
}
```

**Business Rules**:
- New leads have isClosed=false
- Closed leads have isClosed=true and closedAt timestamp
- Agents can only see leads where they are assignedToId
- Managers can see all leads where they are ownerId
- Closed leads are read-only for agents
- Managers can reopen closed leads

---

### 3. form_config Collection

**Purpose**: Store manager-defined form configurations (singleton)

**Collection ID**: `form_config`

**Attributes**:

| Attribute | Type | Required | Size | Default | Description |
|-----------|------|----------|------|---------|-------------|
| fields | string | Yes | 65535 | - | JSON array of FormField objects |
| version | integer | Yes | - | 1 | Configuration version (incremented on update) |
| updatedBy | string | Yes | 255 | - | User ID of manager who last updated |

**Indexes**:
- `version_idx` (key): Track configuration versions

**Permissions**:
- Read: Any authenticated user (agents need to see form config)
- Create: Managers only
- Update: Managers only
- Delete: Managers only

**Singleton Pattern**:
- Use fixed document ID: `'current'`
- Only one active configuration exists at a time
- Version number increments on each update

**Fields Structure**:
```json
[
  {
    "id": "1",
    "type": "text",
    "label": "First Name",
    "key": "firstName",
    "required": true,
    "visible": true,
    "order": 1
  },
  {
    "id": "6",
    "type": "dropdown",
    "label": "Source",
    "key": "source",
    "required": false,
    "visible": true,
    "order": 6,
    "options": ["Website", "Referral", "Cold Call", "Social Media"]
  }
]
```

**Business Rules**:
- Managers can add, remove, reorder, and configure fields
- Agents see only fields where visible=true
- Form validation is generated from field configuration
- Changes take effect immediately after publish

-
osite): Ensure one rule per component+role

**Permissions**:
- Read: Any authenticated user (to check access)
- Create: Managers only
- Update: Managers only
- Delete: Managers only

**Component Keys**:
- `dashboard`: Main dashboard view
- `leads`: Active leads management
- `history`: Closed leads history
- `user-management`: Agent creation and management
- `field-management`: Form builder
- `settings`: System settings and access control

**Default Rules**:
```json
[
  { "componentKey": "dashboard", "role": "agent", "allowed": true },
  { "componentKey": "leads", "role": "agent", "allowed": true },
  { "componentKey": "history", "role": "agent", "allowed": false },
  { "componentKey": "user-management", "role": "agent", "allowed": false },
  { "componentKey": "field-management", "role": "agent", "allowed": false },
  { "componentKey": "settings", "role": "agent", "allowed": false }
]
```

**Business Rules**:
- Managers always have access to all components (hardcoded)
- Agents' access is controlled by these rules
- If no rule exists for a component+role, default to denied for agents
- Changes take effect immediately

---

## Permission Strategy

### Collection-Level Permissions
Set at collection creation, define who can perform operations:
- **Read**: Who can query documents
- **Create**: Who can create new documents
- **Update**: Who can modify documents
- **Delete**: Who can remove documents

### Document-Level Permissions
Set on individual documents (especially for leads):
- More granular control than collection-level
- Used to restrict lead access to owner and assigned agent
- Updated dynamically when leads are reassigned

### Permission Patterns

**Public Read, User Write** (users, form_config, access_config):
```typescript
[
  Permission.read(Role.any()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
]
```

**Document-Level** (leads):
```typescript
// Set on each lead document
[
  Permission.read(Role.user(ownerId)),
  Permission.read(Role.user(assignedToId)),
  Permission.update(Role.user(ownerId)),
  Permission.update(Role.user(assignedToId)), // Only if not closed
  Permission.delete(Role.user(ownerId)),
]
```

---

## Data Flow Examples

### Creating a Lead

1. Manager fills out lead form
2. Form data validated against current form_config
3. Data serialized to JSON string
4. Lead document created with:
   - data: JSON string
   - status: from form
   - ownerId: current manager ID
   - assignedToId: selected agent or null
   - isClosed: false
5. Document permissions set to [ownerId, assignedToId]
6. Lead appears in manager's and agent's lead lists

### Assigning a Lead

1. Manager selects new agent from dropdown
2. Lead document updated:
   - assignedToId: new agent ID
3. Document permissions updated:
   - Add read/update for new agent
   - Remove update for old agent (if changed)
4. Lead appears in new agent's lead list
5. Old agent loses access (if changed)

### Closing a Lead

1. User clicks close lead button
2. Lead document updated:
   - isClosed: true
   - closedAt: current timestamp
   - status: 'Closed' or selected status
3. Document permissions updated:
   - Remove update permission for agent
   - Keep read permission
4. Lead disappears from Active Leads
5. Lead appears in History view

### Updating Form Configuration

1. Manager modifies fields in form builder
2. Manager clicks publish
3. form_config document updated:
   - fields: new JSON array
   - version: incremented
   - updatedBy: manager ID
4. All users see new form immediately
5. Existing leads retain their data structure
6. New leads use new form structure

---

## Maintenance

### Backup Strategy
- Regular database backups through Appwrite console
- Export form_config and access_config before major changes
- Keep version history of form configurations

### Monitoring
- Track form_config version changes
- Monitor lead creation and closure rates
- Watch for permission errors in logs

### Optimization
- Indexes are already optimized for common queries
- Consider adding composite indexes if complex queries become slow
- Monitor collection sizes and plan for scaling

---

## Migration Notes

### Adding New Fields to Leads
No migration needed! The dynamic JSON structure supports new fields automatically:
1. Manager adds field in form builder
2. New leads include the field
3. Old leads don't have the field (handle gracefully in UI)

### Changing Field Types
Requires careful handling:
1. Add new field with new type
2. Migrate data in application layer
3. Remove old field after migration complete

### Adding New Components
1. Add component key to ComponentKey type
2. Create default access rule for agents
3. Update navigation to check access

---

## Security Considerations

### API Key Security
- Never expose API keys in client-side code
- Use environment variables for all credentials
- Rotate API keys regularly
- Use separate keys for dev/staging/production

### Permission Enforcement
- Always check permissions at database level
- Don't rely solely on UI hiding
- Validate user roles on every request
- Use document-level permissions for sensitive data

### Data Validation
- Validate all input before storing
- Sanitize JSON data to prevent injection
- Enforce field requirements at application level
- Use zod schemas for type safety

### Audit Trail
- Track who creates/updates documents (updatedBy)
- Preserve closedAt timestamps
- Log permission changes
- Monitor failed access attempts
