# Security

## Reporting

Please use GitHub's private security-advisory mechanism in this repository to
report a suspected vulnerability. Do not open a public issue or disclose a
vulnerability before a fix is available. Include a concise description,
reproduction steps, and the affected surface, but never include credentials,
personal data, or production records.

## Runtime controls

The application validates request bodies at the API boundary, uses parameterized
database access, applies authentication and authorization middleware, limits
uploads by type and size, checks file signatures, and uses safe generated
filenames for uploaded content. Sensitive configuration is supplied through
environment variables and is never part of this showcase tree.

`RATE_LIMIT_MODE=postgres` uses atomic PostgreSQL windows and HMAC-derived
pseudonymous request keys. `RATE_LIMIT_MODE=single-instance` is an explicit
one-process topology choice, while `memory` is intended only for local
development. PostgreSQL mode requires the `rate_limit_windows` migration.

## Showcase boundary

This repository is a fresh, history-free public subset. It intentionally
excludes credentials, user uploads, private operational material, local
workspace state, user-media migration tooling, and the separately deployed
background Worker implementation. The canonical private repository is not a
safe public remote.

## Local checks

Run the repository hygiene, lint, typecheck, unit-test, and build commands
before sharing changes. CI repeats the application quality gates using
synthetic configuration and disposable test resources.