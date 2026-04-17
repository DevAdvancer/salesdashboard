# NewPulse CRM Documentation

This folder is the working documentation set for the current codebase in `C:\Users\Vizva\developer\Projects\WEB\sales\newpulsecrm`.

The goal of this set is simple: if the current maintainer is unavailable, a new developer should still be able to understand how the app is structured, how it runs, where the important logic lives, and what the current implementation caveats are.

## Start Here

1. Read [01-system-overview.md](./01-system-overview.md) for the product, roles, and feature map.
2. Read [02-setup-and-environment.md](./02-setup-and-environment.md) before trying to run or configure the app.
3. Read [03-architecture-and-runtime.md](./03-architecture-and-runtime.md) to understand providers, auth, routing, and runtime boundaries.
4. Read [04-data-model-and-permissions.md](./04-data-model-and-permissions.md) before changing Appwrite collections, role rules, or access logic.
5. Read [05-routes-and-user-flows.md](./05-routes-and-user-flows.md) for page-by-page behavior and major business flows.
6. Read [06-services-actions-and-apis.md](./06-services-actions-and-apis.md) before modifying server logic, server actions, or route handlers.
7. Read [07-components-and-ui.md](./07-components-and-ui.md) for reusable UI building blocks.
8. Read [08-testing-and-quality.md](./08-testing-and-quality.md) before changing behavior that is already covered by tests.
9. Read [09-known-gaps-and-maintenance-notes.md](./09-known-gaps-and-maintenance-notes.md) before production work, because it documents the current drift and sharp edges.
10. Use [10-file-map.md](./10-file-map.md) as the quick reference for where every important file lives.

## Scope Of This Docs Set

This documentation is based on the code that currently exists in the repository, not on older task notes or idealized product requirements.

That matters because the repository contains:

- Legacy task-by-task notes in this same `docs` folder.
- Older top-level guides such as `README.md` and `SETUP.md`.
- A codebase that has evolved beyond some of those earlier notes.

When there is a difference between this handbook and older notes, treat this handbook as the current code-oriented source of truth and then verify against the actual source files before making risky changes.

## Existing Legacy Docs

The older files already in `docs/` were left in place because they still contain historical context:

- `APPWRITE_SCHEMA.md`
- `APPWRITE_SETUP.md`
- `AUTH_FIX_SUMMARY.md`
- `QUICK_START.md`
- `TASK_*` notes
- `TROUBLESHOOTING_AUTH.md`

Those files are useful as history, but they do not cover the newer assessment, interview, hierarchy, Outlook integration, or multi-manager behavior as completely as this new set.

## Snapshot Notes

These docs were written from the current repository state and reflect a few important realities:

- The development server script uses port `5000`.
- The codebase depends on both Appwrite and Azure/Microsoft Graph.
- There are uncommitted source changes in the working tree outside of this docs work, so this documentation intentionally stays scoped to `docs/`.
