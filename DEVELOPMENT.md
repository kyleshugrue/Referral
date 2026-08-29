# Development Guide

## Prerequisites

- Node.js 24 and npm 10.8+ (see `package.json`)
- PostgreSQL for local development
- A Firebase project for authentication flows, using your own development
  credentials

## Setup

```bash
npm ci
cp .env.example .env
npm run db:push
npm run dev
```

The Express API and Vite frontend run together on port 5000. Database schema
changes are manual and must be reviewed before they are applied.

## Everyday commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run test:unit` | Run unit tests |
| `npm run typecheck:gate` | Run the strict TypeScript gate |
| `npm run lint` | Run ESLint with zero warnings allowed |
| `npm run build` | Build the production application |
| `npm run repo:hygiene` | Validate tracked files and approved assets |

The public tree contains the web application, native source templates,
migrations, tests, CI, and approved genuine demonstration assets. Credentials, user data,
private operations, export controls, and the separately deployed Worker are
outside this showcase boundary.

## Pull requests

Run the relevant checks before opening a pull request. CI also validates that
the public checkout remains buildable and that its runtime output stays
equivalent to the canonical application output.

Never commit `.env` files, Firebase service-account files, user uploads,
generated exports, or local Replit/Agent state. The checked-in example
templates contain placeholders only.