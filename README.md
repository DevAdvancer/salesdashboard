# SalesHub CRM

A manager-controlled customer relationship management system built with Next.js 16 and Appwrite. Designed for hierarchical sales organizations with dynamic form configuration and database-level permission enforcement.

## Features

- 🔐 **Role-Based Access Control**: Manager and Agent roles with granular permissions
- 📝 **Dynamic Form Builder**: Managers can configure lead forms without code
- 👥 **User Management**: Managers create and manage agent accounts
- 📊 **Lead Lifecycle Management**: Track leads from creation through closure
- 🔍 **History & Audit Trail**: Permanent record of all closed leads
- ⚡ **Real-Time Updates**: Changes apply immediately across the system
- 🎨 **Modern UI**: Built with shadcn/ui and Tailwind CSS v4 dark theme
- 🔒 **Database-Level Security**: Permissions enforced by Appwrite

## Quick Start

**New to the project?** See [Quick Start Guide](docs/QUICK_START.md) for 5-minute setup.

### Prerequisites

- Node.js 20+
- Appwrite account (https://cloud.appwrite.io)
- npm or yarn

### Installation

1. **Clone and install dependencies**
   ```bash
   npm install
   ```

2. **Set up Appwrite project**
   - Create project at https://cloud.appwrite.io
   - Create API key with database permissions
   - Copy `.env.local.example` to `.env.local`
   - Add your Project ID and API key

3. **Initialize database**
   ```bash
   npm run setup:appwrite
   ```

4. **Enable authentication**
   - In Appwrite console: Auth → Settings
   - Enable "Email/Password"

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Create your first manager account**
   - Open http://localhost:3000
   - Sign up with email and password

For detailed setup instructions, see [SETUP.md](SETUP.md).

## Documentation

- **[Quick Start Guide](docs/QUICK_START.md)** - Get up and running in 5 minutes
- **[Setup Guide](SETUP.md)** - Complete installation and configuration
- **[Appwrite Configuration](docs/APPWRITE_SETUP.md)** - Database structure and permissions
- **[Requirements](.kiro/specs/saleshub-crm/requirements.md)** - System requirements and acceptance criteria
- **[Design Document](.kiro/specs/saleshub-crm/design.md)** - Architecture and technical design

## Tech Stack

- **Frontend**: Next.js 16.1.6 (App Router), React 19.2.3
- **UI**: shadcn/ui, Radix UI, Tailwind CSS v4
- **Forms**: react-hook-form, zod
- **Backend**: Appwrite (BaaS)
- **Testing**: fast-check (property-based testing)
- **Language**: TypeScript 5

## Project Structure

```
saleshub-crm/
├── app/                    # Next.js app router pages
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── lib/
│   ├── appwrite.ts        # Appwrite client configuration
│   ├── types/             # TypeScript type definitions
│   ├── constants/         # Default configurations
│   └── utils.ts           # Utility functions
├── scripts/
│   └── setup-appwrite.ts  # Database initialization script
├── docs/                  # Documentation
├── .kiro/specs/           # Requirements and design specs
└── .env.local            # Environment variables (not in git)
```

## Key Concepts

### User Roles

- **Manager**: Full system access, creates agents, configures forms and access rules
- **Agent**: Limited access, works only on assigned leads

### Dynamic Forms

Managers design lead forms through a visual builder:
- Add, remove, reorder fields
- Configure field types, validation, visibility
- Changes apply immediately without code deployment

### Permission Model

- **Collection-level**: Base permissions for all documents
- **Document-level**: Granular permissions per lead
- **Role-based**: Managers vs Agents
- **Hierarchy**: Agents linked to creating manager

### Lead Lifecycle

1. **Active**: Lead is open and can be edited
2. **Closed**: Lead is completed and read-only
3. **History**: Permanent audit trail of closed leads
4. **Reopen**: Managers can return leads to active state

## Development

### Available Scripts

```bash
npm run dev              # Start development server
npm run build           # Build for production
npm run start           # Start production server
npm run lint            # Run ESLint
npm run setup:appwrite  # Initialize Appwrite database
```

### Environment Variables

See `.env.local.example` for required variables:
- `NEXT_PUBLIC_APPWRITE_ENDPOINT` - Appwrite API endpoint
- `NEXT_PUBLIC_APPWRITE_PROJECT_ID` - Your project ID
- `APPWRITE_API_KEY` - Server-side API key (for setup script)
- Collection IDs for users, leads, form_config, access_config

## Database Collections

- **users**: User accounts with role and hierarchy
- **leads**: Lead data with dynamic JSON structure
- **form_config**: Form field configuration (singleton)
- **access_config**: Component visibility rules

See [Appwrite Configuration](docs/APPWRITE_SETUP.md) for detailed schema.

## Testing

The project uses a dual testing approach:
- **Unit Tests**: Specific examples and edge cases
- **Property-Based Tests**: Universal correctness properties (fast-check)

Testing will be implemented in subsequent tasks.

## Contributing

This project follows a spec-driven development approach:
1. Requirements define what to build
2. Design document specifies how to build it
3. Tasks break down implementation into steps
4. Tests verify correctness

See `.kiro/specs/saleshub-crm/` for complete specifications.

## Security

- Environment variables never committed to git
- API keys kept secure and rotated regularly
- Database-level permission enforcement
- Document-level access control for leads
- Role-based access throughout the system

## License

Private project - All rights reserved

## Support

For issues or questions:
- Review documentation in `docs/` folder
- Check requirements and design in `.kiro/specs/saleshub-crm/`
- Consult [Appwrite documentation](https://appwrite.io/docs)

---

Built with ❤️ using Next.js and Appwrite
