# CARE360 V1.4 — Staging source package (NOT production ready)

Recovered from the V1.1 ZIP, preserving the original synthetic-only Netlify function and nine contract tests. No live deployments or external systems have been changed.

## Safety gates
- Create a **separate private Git repository** and a **separate Netlify site**; do not connect or overwrite `care360v11`.
- The handler is **disabled unless** `CARE360_VISIT_V11_ENABLED=true`. Set `false` in all deployment contexts initially.
- **Do not make the site public or enable submission yet.** There is no durable per-client rate limiter in this package. Turnstile and Origin checks are not sufficient to prevent high-volume abuse.
- The code uses the original V1.1 environment variable names intentionally. Do not paste secrets into source or Git.
- Verify the Supabase RPC owner, execute grants, inputs, and behaviour separately before any live test.
- Verify Cloudflare Turnstile is configured for the **exact new hostname**. Replace `REPLACE_WITH_DEV_TURNSTILE_SITE_KEY` in `public/index.html` with the new **public site key only**.
- The Netlify function path is `/api/care360/visit-intake-synthetic`; the source file is `netlify/functions/visit-intake-synthetic.mjs`.

## Build / deployment
1. In a **private** repository, upload the *contents* of this folder (not the outer ZIP directory).
2. Connect a **new** Netlify project to that repository, with publish directory `public` and functions directory `netlify/functions` (see `netlify.toml`).
3. Set `CARE360_VISIT_V11_ENABLED=false` and configure server-only credentials through Netlify's environment variables, never in files.
4. Deploy; confirm the function is listed and a POST returns 503 `Synthetic intake disabled`. Do not change site visibility to Public at this stage.
5. Implement and independently test durable server-side rate limiting, audit/monitoring, and correct failure handling before enabling any anonymous intake.
6. Only then conduct a controlled single synthetic submission and verify both the request and consent event in the development database.

## Existing function controls
- Strict four-field synthetic request validation, date window, and single-use Turnstile verification.
- Fixed fictional identity and consent via a privileged Supabase RPC; duplicate ID consistency checks are handled by the database.
- Unknown database outcome returns a 503 warning; **check database before retrying**.
- No real contact details, HLI answers, bookings, or participant data.

## Tests
Run `node --test tests/contract.test.mjs` from this folder. These are local mocked tests only, not live end-to-end security validation.
