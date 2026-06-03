# SalesHub CRM

A full-featured, hierarchical sales team CRM built with **Next.js 16** and **Appwrite**. Designed for multi-branch sales organizations with role-based access control, dynamic lead management, LinkedIn outreach tracking, attendance monitoring, and automated duplicate detection.

---

## 🚀 Quick Start

```bash
npm install
cp .env.local.example .env
# Fill in your Appwrite + Azure AD credentials in .env
npm run setup:appwrite   # Create all DB collections (run once)
npm run dev              # Start dev server → http://localhost:5000
```

> The dev server runs on **port 5000** (not 3000).

---

## 📚 Documentation

Start here depending on your role:

| Goal | Document |
|---|---|
| **New developer onboarding** | [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) |
| **Adding a new feature** | [docs/DEVELOPER_GUIDE.md#22-adding-a-new-feature](docs/DEVELOPER_GUIDE.md#22-adding-a-new-feature--step-by-step-guide) |
| **Service function signatures** | [docs/API_REFERENCE.md](docs/API_REFERENCE.md) |
| **Coding conventions & patterns** | [docs/IMPLEMENTATION_PATTERNS.md](docs/IMPLEMENTATION_PATTERNS.md) |
| **Appwrite schema details** | [docs/APPWRITE_SCHEMA.md](docs/APPWRITE_SCHEMA.md) |
| **Initial setup (Appwrite)** | [docs/APPWRITE_SETUP.md](docs/APPWRITE_SETUP.md) |
| **Auth troubleshooting** | [docs/TROUBLESHOOTING_AUTH.md](docs/TROUBLESHOOTING_AUTH.md) |
| **Known issues & tech debt** | [docs/DEVELOPER_GUIDE.md#23-known-limitations](docs/DEVELOPER_GUIDE.md#23-known-limitations--technical-debt) |

---

## ✨ Features Implemented

| Feature | Status | Notes |
|---|---|---|
| Email/Password Auth via Appwrite | ✅ | Admin-created accounts only |
| Role-Based Access Control | ✅ | 5 roles: admin, developer, team_lead, agent, lead_generation |
| DB-level Access Override | ✅ | Admins can override default access rules per role |
| Lead CRUD with Duplicate Detection | ✅ | Email + phone + LinkedIn URL uniqueness enforced |
| Lead Status Workflow | ✅ | Enforced transitions, esp. for LinkedIn leads |
| Lead Notes (visibility-gated) | ✅ | team / leadership / manager_only visibility |
| Lead Follow-Up Scheduler | ✅ | Overdue detection + work queue |
| Audit Logging | ✅ | All mutations logged with actor + metadata |
| Branch Management | ✅ | Multi-branch user assignment |
| User Management | ✅ | Create team leads + agents |
| Hierarchy Viewer | ✅ | Org chart |
| Attendance Tracking | ✅ | Self-toggle + TL override + escalation |
| LinkedIn Account Management | ✅ | Main + sudo account types |
| LinkedIn Request Tracker | ✅ | Per-agent outreach log |
| LinkedIn Withdrawal Reminders | ✅ | Cron job |
| Referral / Lead Request Form | ✅ | Public URL, duplicate validation |
| In-App Notifications | ✅ | Real-time bell + notification list |
| Chat (Announcement + General) | ✅ | Channel-based |
| Coaching Notes | ✅ | Manager → agent notes |
| Review Queue | ✅ | Pending approval items |
| Weekly Reports | ✅ | Performance dashboard |
| Duplicate Alert Email | ✅ | Via Microsoft Graph API |
| Payment Plan Tracker | ✅ | Per-client payment status |
| Mock/Assessment/Interview Tools | ✅ | Email-based support tools |
| Page Tour Guide | ✅ | Driver.js onboarding |
| Dark/Light Mode | ✅ | Toggle on referral page + CSS vars |
| Sentry Error Monitoring | ✅ | Client + server |
| Form Field Management | ⚠️ Disabled | UI exists, service layer disabled |
| Signup Flow | ⚠️ Disabled | Admin creates users manually |

---

## 🏗️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 + CSS custom properties |
| Backend (BaaS) | Appwrite v22 |
| Email | Microsoft Graph API |
| Error Tracking | Sentry |
| Icons | Lucide React |
| Charts | Recharts |
| Forms | React Hook Form + Zod |
| Tours | Driver.js |
| Testing | Jest + React Testing Library |

---

## 🔐 User Roles

| Role | Can Do |
|---|---|
| `admin` | Everything |
| `developer` | Same as admin (for dev team) |
| `team_lead` | Manage agents, see team leads, attendance |
| `agent` | Create & manage own leads, LinkedIn outreach |
| `lead_generation` | Create leads only, no history/reports |

---

## 📁 Key Directories

```
app/           → Pages & API routes (Next.js App Router)
components/    → React components
lib/
  services/    → Client-side business logic (Appwrite client SDK)
  server/      → Server-only helpers (node-appwrite, email)
  contexts/    → React contexts (auth, access control)
  constants/   → Configuration tables (access rules, collection IDs)
  types/       → All shared TypeScript interfaces
docs/          → Project documentation (you are here)
scripts/       → One-off Appwrite setup scripts
tests/         → Jest unit tests
```

---

## 🧪 Running Tests

```bash
npm run test              # All tests
npm run test:coverage     # With coverage report
npm run test:watch        # Watch mode
```

---

## 🐳 Docker

```bash
docker-compose up --build
```

Runs on port 5000.

---

## 🆘 Common Issues

- **"No session" error** → JWT cookie expired. Log out and back in.
- **Lead not visible** → Check user's `branchIds` match the lead's `branchId`.
- **Duplicate alert not emailing** → Check Azure AD credentials in `.env`.
- **Form field not saving** → Field management is intentionally disabled (`updateFormConfig` throws).

See [docs/TROUBLESHOOTING_AUTH.md](docs/TROUBLESHOOTING_AUTH.md) for auth-specific issues.

---

*Built and maintained by the DevAdvancer team.*
