# Quick Start Guide - SalesHub CRM

## 5-Minute Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Create Appwrite Project
1. Go to https://cloud.appwrite.io
2. Create new project
3. Copy Project ID

### 3. Create API Key
1. Settings → API Keys → Create
2. Enable all database scopes
3. Copy API key

### 4. Configure Environment
```bash
cp .env.local.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_APPWRITE_PROJECT_ID=your-project-id
APPWRITE_API_KEY=your-api-key
```

### 5. Setup Database
```bash
npm run setup:appwrite
```

### 6. Enable Authentication
1. In Appwrite console: Auth → Settings
2. Enable "Email/Password"

### 7. Start Development
```bash
npm run dev
```

Open http://localhost:3000

### 8. Create Manager Account
1. Go to signup page
2. Create account
3. You're now a manager!

## Project Structure

```
saleshub-crm/
├── app/                    # Next.js app router pages
├── lib/
│   ├── appwrite.ts        # Appwrite client config
│   ├── types/             # TypeScript type definitions
│   └── constants/         # Default configurations
├── scripts/
│   └── setup-appwrite.ts  # Database setup script
├── docs/                  # Documentation
└── .env.local            # Environment variables (not in git)
```

## Key Files

- **lib/appwrite.ts**: Appwrite client and service exports
- **lib/types/index.ts**: All TypeScript interfaces
- **lib/constants/default-fields.ts**: Default form fields
- **lib/constants/default-access.ts**: Default access rules
- **scripts/setup-appwrite.ts**: Database initialization

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| NEXT_PUBLIC_APPWRITE_ENDPOINT | Appwrite API endpoint | https://cloud.appwrite.io/v1 |
| NEXT_PUBLIC_APPWRITE_PROJECT_ID | Your project ID | 6abc123def456 |
| APPWRITE_API_KEY | Server-side API key | d1234567890abcdef |
| NEXT_PUBLIC_APPWRITE_DATABASE_ID | Database ID | crm-database-1 |

## Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build           # Build for production
npm run start           # Start production server

# Setup
npm run setup:appwrite  # Initialize Appwrite database

# Code Quality
npm run lint            # Run ESLint
```

## Default Configuration

### Form Fields (13 fields)
- First Name, Last Name, Email (required)
- Phone, Company, Source, Status
- Owner, Assigned To, Legal Name
- SSN (Last 4), Visa Status, Notes

### Access Rules
**Agents can access:**
- ✅ Dashboard
- ✅ Leads

**Agents cannot access:**
- ❌ History
- ❌ User Management
- ❌ Field Management
- ❌ Settings

**Managers can access everything**

## Next Steps

1. **Create Agents**: User Management → Create Agent
2. **Customize Forms**: Field Management → Add/Edit Fields
3. **Adjust Access**: Settings → Component Visibility
4. **Create Leads**: Leads → New Lead

## Troubleshooting

### Setup script fails
- Check API key has all database permissions
- Verify Project ID is correct
- Ensure internet connection is stable

### Can't login
- Verify Email/Password auth is enabled in Appwrite
- Check endpoint and project ID in .env.local
- Clear browser cookies

### Changes not appearing
- Restart dev server after .env.local changes
- Clear Next.js cache: `rm -rf .next`
- Hard refresh browser (Ctrl+Shift+R)

## Architecture Overview

```
┌─────────────┐
│  Next.js    │  Frontend (React 19, Tailwind CSS v4)
│  App Router │
└──────┬──────┘
       │
       │ Appwrite SDK
       │
┌──────▼──────┐
│  Appwrite   │  Backend (BaaS)
│  Cloud      │
└──────┬──────┘
       │
       │
┌──────▼──────────────────────┐
│  crm-database-1             │
│  ├── users                  │
│  ├── leads                  │
│  ├── form_config            │
│  └── access_config          │
└─────────────────────────────┘
```

## Key Concepts

### Manager vs Agent
- **Manager**: Full access, creates agents, configures system
- **Agent**: Limited access, works on assigned leads only

### Dynamic Forms
- Managers design forms without code
- Changes apply immediately
- No database migrations needed

### Permission Enforcement
- Database-level security (Appwrite)
- Document-level permissions for leads
- Role-based access control

### Lead Lifecycle
1. **Active**: Can be edited
2. **Closed**: Read-only, in history
3. **Reopened**: Back to active (managers only)

## Resources

- [Full Setup Guide](../SETUP.md)
- [Appwrite Configuration](./APPWRITE_SETUP.md)
- [Requirements](../.kiro/specs/saleshub-crm/requirements.md)
- [Design Document](../.kiro/specs/saleshub-crm/design.md)
- [Appwrite Docs](https://appwrite.io/docs)

## Support

For detailed information, see:
- `SETUP.md` - Complete setup instructions
- `docs/APPWRITE_SETUP.md` - Database structure details
- `.kiro/specs/saleshub-crm/` - Requirements and design docs
