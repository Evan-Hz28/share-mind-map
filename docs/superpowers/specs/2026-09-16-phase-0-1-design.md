# Shared Mind Map Phase 0-1 Design

**Status:** Approved in chat on 2026-09-16

**Scope authority:** `target.md`, then the four baseline documents in their
declared conflict order.

## 1. Outcome and Boundary

This delivery completes phase 0 (technical validation) and phase 1 (platform
foundation). It produces a runnable pnpm TypeScript monorepo with a Vue web
application, NestJS API, independent Node worker, PostgreSQL, Redis, MinIO,
OpenAPI-generated client, authentication and account administration.

The delivery also produces reproducible evidence for the canvas decision and
XMind safety boundary. It does not implement folders, document CRUD, editing
requests, imports as a user-facing workflow, edit locks, realtime document
updates, history, search, trash, or production backup orchestration. Those
remain phases 2-6.

Phase 0 experiments are explicitly labelled synthetic. Their results establish
technical feasibility and known limitations; they are not business-sample or
production-performance acceptance.

## 2. Repository and Dependency Boundaries

The workspace uses Node.js 24, pnpm 11, TypeScript, and pnpm workspaces without
Nx or Turborepo.

```text
apps/web/                 Vue 3 application and canvas benchmark host
apps/api/                 NestJS REST API and future Socket.IO boundary
apps/worker/              Independent XMind/background worker and health server
packages/database/        Drizzle schema, migrations, repositories
packages/document-model/  Cloud document Schema V1 and runtime validation
packages/xmind/           ZIP inspection, XMind parsing, conversion, reports
packages/api-client/      OpenAPI document, generated client, runtime wrapper
tests/e2e/                Playwright platform flows
tests/fixtures/xmind/     Generated synthetic fixtures and manifest
scripts/                  Generators, benchmarks, drift and verification tools
infra/                    Container configuration
docs/adr/                 Technical decisions and measured PoC evidence
```

Allowed dependency flow is:

```text
web -> api-client + document-model
api -> database + document-model
worker -> database + document-model + xmind
```

`packages/xmind` may depend on `document-model` to produce standard documents.
No package may depend on `apps/*`. Shared behavior must live in its owning
domain package rather than a generic utility package.

## 3. Technology Decisions

- Database access: Drizzle ORM with `pg`; migrations are checked-in SQL and may
  use PostgreSQL constraints that are more precise than the TypeScript schema.
- Persisted phase 1 entity and API resource IDs use application-generated
  UUIDv7. Deterministically derived XMind sheet/node/relationship IDs use UUIDv5
  under the document identity namespace. ULIDs are not mixed in.
- Validation: Zod for environment and document-model validation;
  `class-validator`/`class-transformer` DTOs for NestJS request validation and
  OpenAPI metadata.
- API contract: `@nestjs/swagger` emits deterministic OpenAPI JSON;
  `@hey-api/openapi-ts` generates the TypeScript client.
- Tests: Vitest for unit and integration tests, Supertest for HTTP integration,
  Testcontainers where a real dependency is required, and Playwright for
  browser workflows and canvas measurements.
- Session and rate-limit storage: direct Redis access with atomic Lua scripts.
- Password hashing: Argon2id through the native `argon2` package.
- Worker queue: BullMQ on Redis. Redis contains coordination state only; phase
  1 business identities, memberships, and audit records remain in PostgreSQL.
- ZIP reading: lazy entry streaming. No XMind archive is inflated wholesale in
  the API process.

Important library choices and their versions are locked in the pnpm lockfile
and recorded in the relevant ADR after installation and testing.

## 4. Standard Document Schema V1

The canonical model is independent of XMind and all canvas libraries.

```ts
type CloudDocumentV1 = {
  schemaVersion: 1;
  documentId: string; // UUID
  version: number; // non-negative integer
  sheets: CloudSheetV1[]; // at least one
  extensions: Record<string, JsonValue>;
};

type CloudSheetV1 = {
  id: string;
  title: string;
  rootNodeId: string;
  nodes: Record<string, CloudNodeV1>;
  relationships: CloudRelationshipV1[];
  extensions: Record<string, JsonValue>;
};

type CloudNodeV1 = {
  id: string;
  parentId: string | null;
  childIds: string[];
  title: string;
  priority: "P0" | "P1" | "P2" | null;
  notes: { format: "plain"; text: string } | null;
  labels: string[];
  icons: string[];
  style: {
    textColor?: string;
    backgroundColor?: string;
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
  };
  imageAssetId: string | null;
  extensions: Record<string, JsonValue>;
};
```

Relationships have stable IDs, source and target node IDs, an optional title,
optional line style, and namespaced extensions. Runtime validation enforces one
reachable root per sheet, matching map keys and node IDs, consistent parent and
child links, no cycles, no duplicate children, valid relationship targets,
unique sheet/node/relationship IDs, and at most 20,000 nodes per document.

Sibling order is exclusively `childIds` order. IDs remain stable across saves.
Unknown fields are retained only under an explicitly namespaced extension key.
Canvas serialization never enters this schema.

`collapsed` is user view state, not shared document state. Selection, expansion,
scroll, and zoom remain in the web client view model so one reader cannot alter
another reader's view and snapshot replacement can restore local context.

## 5. XMind Validation and Worker Isolation

Reproducible generators create clearly labelled synthetic fixtures for current
JSON format, legacy XML format, multiple sheets, embedded PNG, unknown
extensions, corrupt bytes, path traversal, excessive compression ratio, 5,000
nodes, and 20,000 nodes. A manifest records the generator version, SHA-256,
expected result, expected node count, and synthetic provenance.

Archive inspection applies these defaults before parsing:

- compressed input limit: 20 MiB;
- entry count limit: 10,000;
- per-entry uncompressed limit: 50 MiB;
- total uncompressed limit: 200 MiB;
- compression ratio limit: 100:1 per entry and archive;
- document node limit: 20,000;
- processing deadline: 5 minutes;
- reject absolute paths, traversal segments, NUL bytes, encrypted entries,
  duplicate canonical paths, unsupported archive structures, and mismatched
  content signatures.

The API never imports or parses an XMind archive during phases 0-1. A worker
verification command enqueues fixture jobs, the separate `apps/worker` process
reads and validates them, and the verifier checks stable success/failure codes.
The queue result is verification evidence, not persistent business data.

The conversion report distinguishes preserved, normalized, unsupported-online,
and rejected features. Unknown safe XMind data may be retained under a
namespaced `extensions.xmind` value when a tested round-trip rule exists.

## 6. Canvas PoC

The same generated document samples and browser harness evaluate
`simple-mind-map`, MindElixir, and jsMind. Each candidate is wrapped behind the
same minimal adapter and measured in Chromium with warm-up separated from the
recorded run.

The report records:

- package version, bundled license text, internal deployment/modification
  compatibility, and external-cloud dependency;
- Vue 3 mount/unmount behavior and adapter isolation;
- read-only mode, stable IDs, node creation/deletion/reparenting/reordering,
  collapse, keyboard hooks, zoom/pan, undo hook, image, label, icon, and basic
  style support;
- first usable render for 5,000 and 20,000 nodes;
- full snapshot replacement and restoration of selection/expansion/viewport;
- heap before/after mount, replacement, and destroy where Chromium exposes it;
- deterministic standard-model export and known gaps.

An ADR selects a component only when measured evidence supports it. If no
candidate meets the 5,000-node three-second and 20,000-node five-second targets,
the ADR states that phase 4 scope must be re-reviewed; it does not hide the
failure behind an unmeasured choice.

## 7. Platform Data Model

Phase 1 migrations create `organizations`, `workspaces`, `users`,
`auth_identities`, `workspace_memberships`, and `audit_logs`. The organization
has one default workspace. Local identity subjects are lowercase normalized
login names and are unique per organization/provider. User records remain
separate from identities.

Membership role is `reader`, `editor`, or `admin`; status is `active` or
`revoked`. The first administrator transaction creates the organization,
workspace, user, local identity, active admin membership, and audit event.

Database constraints enforce valid statuses/providers, required local hashes,
case-insensitive identity uniqueness through normalized subjects, one
membership per user/workspace, and UTC timestamps. Migrations must succeed from
an empty PostgreSQL database and repeated migration execution must be a no-op.

## 8. Authentication and Session Flow

Login names contain 3-64 ASCII letters, digits, dots, underscores, or hyphens;
comparison is case-insensitive. Passwords contain 12-128 Unicode characters and
are hashed exactly as entered without trimming or normalization.

Argon2id production defaults are 64 MiB memory, 3 iterations, and parallelism
1. Test-only lower costs are enabled explicitly under the test environment and
cannot be selected in production configuration.

Successful login creates 32 random bytes encoded as base64url. The raw token is
sent only in the `smm_session` HttpOnly cookie. Redis keys use a SHA-256 digest
of the token and store user/workspace/role/password-change state with a 24-hour
TTL plus a per-user set for complete revocation.

Cookie defaults are `HttpOnly`, `SameSite=Lax`, path `/`, and `Secure=true` in
production. Production configuration rejects an insecure cookie setting.
Frontend code never persists the token.

Failed login has identical public behavior for nonexistent, wrong-password,
disabled, and revoked accounts. Atomic Redis scripts enforce five consecutive
failures per normalized account per 15 minutes and 50 failures per source
address per 15 minutes. Account failures clear on successful login; source
failures expire naturally. Logs and keys use digests rather than raw login
names or addresses.

Sessions requiring a password change may call only `GET /me`,
`PUT /auth/password`, `POST /auth/logout`, and the CSRF bootstrap endpoint.
Password change, administrator reset, account disable, and explicit revoke-all
delete every server session for that user. If revocation fails, the account
mutation does not return success and its database transaction is rolled back.

State-changing cookie-authenticated requests require a session-bound CSRF token
in `X-CSRF-Token`. The token is returned by a safe bootstrap endpoint, kept only
in Pinia memory, rotated with the session, and documented in OpenAPI.

## 9. Administration and Operations

The phase 1 API exposes login, logout, password change, current-user, CSRF,
health, and these administrator operations:

- list members;
- create a local Reader account and return its generated temporary password
  once;
- reset a member to a new generated temporary password once;
- disable or restore an account;
- revoke every session for a member.

Temporary passwords use a cryptographically secure generator and meet the
normal password policy. They never enter logs or audit metadata.

Disabling an account locks the relevant membership rows and rejects the change
when it would leave no active administrator. All restricted endpoints use the
same server-side role guard; frontend visibility is only a usability layer.

Reader, Editor, and Admin guards are all implemented in phase 1. The Admin
guard protects member operations. Reader and Editor behavior is exercised
through test-only controllers in the Nest integration test module until phases
2-4 add their production endpoints; no fake production endpoint is added only
to make a guard appear used.

The first-admin command is interactive and idempotent. It asks for organization,
workspace, login, and display names, confirms the action, generates the
temporary password, and displays it exactly once. The recovery command asks for
an existing administrator login and confirmation, resets to a generated
temporary password, revokes all sessions, and writes an operations audit event.
Neither command accepts a password argument or password environment variable.

## 10. API, Errors, Logging, and Health

REST uses `/api/v1`. Errors use the baseline envelope with a request ID. The
phase 1 contract adds stable codes for invalid input, CSRF rejection, duplicate
login, last-active-admin protection, and unavailable dependencies; each code
maps to one HTTP status and one safe default message.

Every request receives or generates a request ID. JSON logs contain time,
level, service, environment, request ID, safe internal IDs, operation, duration,
result, and error code. A redaction layer removes password fields, temporary
passwords, authorization/cookie/CSRF headers, session tokens, document bodies,
and secrets.

`/health/live` proves the process event loop is serving. `/health/ready` checks
PostgreSQL, Redis, and MinIO with bounded timeouts and returns only safe status
names. Worker liveness/readiness additionally checks queue connectivity. The web
container exposes an HTTP health endpoint through its static server.

Email is represented by a narrow `MailProvider` port with an SMTP adapter.
Configuration validates SMTP host, port, sender, TLS mode, and optional
credentials without logging their values. Local Compose points the adapter at
Mailpit; automated application tests inject a recording mock provider. Phase 1
does not invent notification workflows, but the adapter, dependency health
check, and failure mapping are complete for later alert consumers.

## 11. OpenAPI and Generated Client

NestJS is the contract source. A deterministic command builds the application
metadata without binding a network port and writes the OpenAPI document to
`packages/api-client/openapi.json`. The generated code lives only under
`packages/api-client/src/generated`; handwritten code may configure the base
URL, credentials, CSRF header, and safe error mapping but may not duplicate API
request/response types.

Generation checking writes OpenAPI and client output to a temporary directory
and recursively compares it with the checked workspace files. This works even
while the feature branch intentionally contains uncommitted changes.

## 12. Web Experience

The Vue application opens on the actual login workflow, not a marketing page.
It uses Element Plus controls, Pinia, Vue Router, and iconography from the
enabled Element Plus icon set.

Routes cover login, mandatory password change, authenticated workspace shell,
and administrator members. A Reader sees the default workspace shell without
document fixtures or phase 2 controls. Admin navigation exposes member
management; Reader and Editor navigation does not. Route guards improve the
experience, while the API remains authoritative.

The layout is restrained and work-focused: compact top navigation, clear status
and error feedback, keyboard-accessible forms, responsive member actions, and a
mobile layout without editing controls. The browser tests verify desktop and
mobile rendering, overflow, console errors, and network failures.

## 13. Containers and Local Runtime

Compose contains `web`, `api`, `worker`, `postgres`, `redis`, `minio`,
`minio-init`, and `mailpit`. Web, API, and worker use repository Dockerfiles and
health checks. Dependency conditions prevent readiness races. Persistent volumes
remain for PostgreSQL, Redis, MinIO, and Mailpit, but Redis persistence is never
treated as the business source of truth.

`.env.example` contains explicit local-only values or obvious placeholders.
Production config validation requires replacement secrets and secure cookies.
No command reads or prints a real `.env` file during implementation or
verification.

The README documents prerequisites, pnpm installation, configuration, local and
Compose startup, migrations, OpenAPI/client generation, fixture generation,
tests, first-admin initialization, administrator recovery, account operations,
health troubleshooting, and service addresses. It also lists synthetic-sample
limitations, real SMTP/server/business-sample integration steps, phase 6 release
gates, residual risks, and the unimplemented phase 2-6 boundary.

## 14. Verification Strategy

Behavior is implemented with red-green-refactor cycles. Unit tests cover schema
invariants, login/password normalization, Argon2 configuration, role decisions,
rate-limit scripts, error mapping, ZIP limits, XMind conversion, and redaction.

Integration tests use real PostgreSQL and Redis for migrations, identity
transactions, uniqueness, sessions, rate limits, all-session revocation,
last-admin locking, and role matrices. MinIO readiness uses a real local service.
HTTP tests cover uniform login failures and every restricted endpoint.

Playwright covers first-admin setup, Reader creation, temporary-password login,
mandatory password change, normal re-login, logout, rate limiting, password
reset, disable/restore, last-admin protection, session revocation, role-aware
navigation, desktop/mobile layout, and browser console errors.

Final verification runs install/lock consistency, format, lint, TypeScript,
unit tests, API integration tests, all package/application builds, OpenAPI/client
drift, empty-database migration and repeat migration, fixture generation and
worker validation, canvas benchmarks, Compose health, and browser E2E. Results,
machine context, addresses, known limitations, and external phase 6 gates are
recorded without claiming production readiness.

## 15. Delivery Sequence

1. Establish workspace tooling and deterministic quality commands.
2. Implement Schema V1 and generated XMind fixtures with invariant tests.
3. Implement safe XMind inspection/conversion and independent worker proof.
4. Build and measure the canvas candidate harness; publish the ADR.
5. Implement database schema, empty-database migrations, and repositories.
6. Implement API foundation, OpenAPI generation, health, errors, and logging.
7. Implement authentication, sessions, rate limiting, CLI administration, and
   administrator account APIs.
8. Generate the client and implement the Vue authentication/admin experience.
9. Complete Compose service images, integration/E2E tests, documentation, and
   the full verification matrix.

Each sequence item must pass its focused checks and independent review before
the next item builds on it. No milestone is reported complete with failing or
unrun required checks.
