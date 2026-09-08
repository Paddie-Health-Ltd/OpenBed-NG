# OpenBed-NG

A Centralised National Portal with a lightweight update model is vital for Nigeria. The "No Bed Conundrum" causes avoidable emergency deaths daily, as ambulances navigate blindly between tertiary centers like LUTH, LASUTH, or regional General Hospitals without real-time status. Real-time visibility across wards saves lives nationwide.

This repository holds **BedSpace v1**: the visibility layer. Facilities publish
per-category bed capacity; a referring clinician finds it, calls, and records
what happened.

## What this is not

v1 is **not** a bed-allocation or patient-routing system. There is deliberately
no pre-arrival routing, no state coordination unit, no surge protocol, no
transport integration, no ranking by clinical suitability, no triage, no ETA and
no patient-specific input of any kind. Those last five are a permanent product
constraint, not a backlog: any one of them plausibly brings this software inside
medical-device regulation.

Every number this system shows is **indicative**. It is a claim a ward made at a
stated time, not a reservation and not a guarantee. Call the facility before you
travel.

## What this repository does not contain

- **No personal data.** No staff names, no phone numbers, no patient data of any kind.
- **No real facility data.** The facility list is never committed.
- **No real duty phone numbers.** Not in code, not in tests, not in fixtures.
- **No production credentials.** Nothing here requires one to run.
- **All seed data is synthetic**, and lives in `database/seed/`.

If you find any of the above in this repository or its history, please report it
privately — see [SECURITY.md](SECURITY.md).

## Licence, and an honest note on the non-commercial covenant

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

**Apache 2.0 permits commercial use by anyone.** Any commitment that BedSpace is
not monetised, is not a lead-generation channel, and shares no infrastructure
with any commercial health product is a *contractual* commitment by the operator
of a specific deployment. It is not a term of this licence, it does not bind you
if you fork this code, and it cannot be enforced through the licence. Anyone
describing the licence as containing such a covenant is describing it wrongly.

If you self-host, [NOTICE](NOTICE) explains what you take on: you become an
independent data controller, you are solely responsible for the accuracy of
whatever you publish, and you may not use the project's names.

Contributions are not open yet. There is deliberately no `CONTRIBUTING.md` and
no good-first-issues until the golden path is stable and the first facilities are
live — seeding issues against components about to be rewritten wastes
contributors' time. Watch the repository if you want to know when that changes.

## Architecture in one paragraph

Private base tables live in an `app` schema that is **not** exposed to PostgREST,
so they are unreachable by an anonymous client at any policy setting. `public`
contains only publishable projection tables and a capped RPC surface. RLS is the
second line, not the only line. The public dashboard reads a static snapshot
regenerated every 60 seconds and served from a CDN — not a live database
connection — so a traffic spike costs one origin read per minute regardless of
how many people are watching, and the user's coordinates never leave their
device. See [`docs/`](docs/) for the long version.

## Development

Prerequisites: **Node 22.13+** (see `.nvmrc`), **Docker** (the Supabase CLI runs
Postgres and PostgREST in containers), and **`psql`** (the migration runner uses
it; on macOS, `brew install libpq` and add it to your `PATH`).

```bash
npm ci
npm run db:start          # supabase start — Postgres + PostgREST + GoTrue
npm run db:reset          # reset, apply database/migrations/, load synthetic seed
npm run test              # the full suite
npm run test:db           # database and RLS negative tests only
npm run test:compliance   # repo-level guard tests only (no database needed)
```

Migrations are raw SQL in [`database/migrations/`](database/migrations/), applied
in lexical order by `scripts/run_migrations.sh` and ledgered in
`app.schema_migrations`. Every forward migration has a symmetric `.down.sql`.
**`supabase/migrations/` is deliberately empty** — the Supabase CLI would apply
that directory with its own ledger and its own naming, and two runners over one
schema corrupts it. The CLI here is only a Postgres and PostgREST provider.

Working conventions that are enforced rather than suggested live in
[`.claude/rules/`](.claude/rules/).
