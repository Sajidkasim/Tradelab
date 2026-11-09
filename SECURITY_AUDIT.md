# Security review — 9 November 2026

Scope: FastAPI/React repository, installed npm/Python dependencies, auth/workspace
code and existing regression tests, plus read-only Supabase security advisors and
table privilege metadata. No production data, permission, auth setting or deployment
was changed. This is a focused review, not a penetration-test certification.

## Fixed locally

| Finding | Priority | Fix and verification |
| --- | --- | --- |
| Pillow 12.3 advisory findings on an image-upload path | High | requirements-web now requires Pillow >=13,<14; installed 13.0.0, verified against official release notes. pip-audit is clean after the change. Image-upload regressions run against the patched decoder. |
| Upload limits applied after multipart parsing; login limit trusted Content-Length | Medium | RequestLimits checks actual streamed bytes before parsing, rejecting oversized chunked or falsely declared requests. Login is 8 KiB, all other writes 9 MiB including multipart overhead; existing 5 MiB import and 8 MiB image limits remain. Spools after 1 MiB and closes temporary files. This does not replace reverse-proxy connection/time limits. |
| Formula-like text exported directly to CSV | Medium | Prefix dangerous string cells with an apostrophe in CSV downloads. Stored notes, numeric financial values and JSON backups stay unchanged. HTTP regression confirms this. |
| Missing browser defense-in-depth headers | Low | Added CSP object-src/base-uri/frame-ancestors/form-action restrictions and hosted-only HSTS. Existing nosniff/frame/referrer/cache protections remain. This is deliberately not a strict script-src CSP; chart/video/embed compatibility remains necessary. |
| Import/restore upload handles not explicitly closed after reads | Low | Both paths now close handles in finally blocks, including read failures. |

Pillow reference: https://pillow.readthedocs.io/en/stable/releasenotes/13.0.0.html

## Verified controls

- Writes go through authenticated workspace selection and same-origin/CSRF checks.
  Workspace identities are server-derived, not selected by browser request bodies.
- Google PKCE uses a server-held verifier and a verified provider identity; editable
  user_metadata is not used to decide journal ownership. Provider tokens stay server-side.
- Sessions rotate at sign-in; hosted cookies use Secure/HttpOnly/SameSite controls.
  Existing tests exercise revocation, blocked identities and account isolation.
- Screenshots use validated workspace-scoped object keys, pixel limits, allowed
  formats and re-encoding; no public object URL is returned.
- Learning resource URLs are HTTPS-validated; text content is rendered as React
  text rather than inserted as HTML. Financial calculations remain in Python.
- npm audit: zero advisories. pip-audit after patch: zero advisories. pip check: no
  broken requirements. Counts are advisory-service results, not proof of no flaws.
- Tracked filename scan found no .env/secrets.toml/private-key files; private-key
  block scan of tracked files under 1 MB found none. This is NOT a complete secret
  scan or historical Git audit, and no secret values were printed.

## Live Supabase checks (read-only)

Security advisors reported 76 informational RLS-enabled/no-policy tables and one
warning for disabled leaked-password protection. Catalog checks found no direct
anon/authenticated SELECT/INSERT/UPDATE/DELETE/TRUNCATE privileges on the journal
or auth tables. The only matching table was macro_scorecard: RLS enabled, SELECT
only for those roles, no matching policies returned. Do not grant private-table
policies merely to silence deny-by-default informational notices.

The application uses its backend DB role, so database RLS does not replace the
HTTP workspace authorization checks. Database functions, column privileges,
backup access and external storage-account settings were not exhaustively audited.

Leaked-password protection remains an operator follow-up if Supabase password
sign-in is enabled. The reviewed hosted application uses Google sign-in; the
separate local/password gate uses Argon2. No auth configuration was changed.

Supabase reference: https://supabase.com/docs/guides/api/securing-your-api

## Verification and remaining deployment work

420 pytest passed (four existing deprecation warnings), 96 Vitest passed and
production build passed. Added tests cover streamed-size enforcement, byte-exact
replay of accepted bodies, CSV safety/storage preservation and browser headers.
Three browser checks passed on disposable workspaces: sign-in destination,
screenshot persistence and dark-mode/embed compatibility.

Deploying the changes is required to protect the hosted application; this review
has not deployed them. Verify production headers and rebuild dependencies when
releasing. No live cross-account attack, load test, credential rotation, restore
drill or multi-user penetration test was performed. Review provider-side MFA,
password-provider configuration, ingress timeouts/connection limits and backups
before wider public access. Request size limits alone do not prevent slow uploads
or distributed denial of service.
