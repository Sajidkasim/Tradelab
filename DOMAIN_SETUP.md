# PrimusTrader domain and PrimusLab section

The owner selected **https://primustrader.co.uk/lab** for PrimusLab. The domain
was purchased from Wix. Render remains the host and Supabase remains the database
and Google sign-in service. No additional website builder plan is needed.

## Routing

- `PRIMUSLAB_PUBLIC_URL` remains an HTTPS origin, without `/lab`.
- `PRIMUSLAB_LAB_PATH=/lab` serves the journal at `/lab`, import at `/lab/import`
  and tools at `/lab/tools`. Assets, the private API, privacy notice and OAuth
  callback remain at `/assets`, `/api`, `/privacy` and `/auth/callback` on the
  same origin, ready for other future website sections.
- Until a separate main homepage is built, `/` redirects to `/lab`.
- `PRIMUSLAB_CUSTOM_HOST=primustrader.co.uk` permits testing the new host during
  DNS/TLS setup, before it becomes the canonical public origin.
- `PRIMUSLAB_LEGACY_HOST=primuslab-web.onrender.com` redirects old GET/HEAD links
  to the canonical journal after cutover. Queries, OAuth codes and POST bodies
  are never forwarded between hosts. Old-domain writes return 409.
- Runtime configuration injects the validated Lab path into the compiled index.
  The same build supports legacy root previews and the production `/lab` layout.

## Cutover sequence

1. Deploy the tested routing with the old public origin and `/lab` enabled.
2. Add `primustrader.co.uk` to the existing Render service. Render also prepares
   `www` and its redirect to the root domain. Use Render's displayed DNS targets.
3. In Wix, replace root A records with Render's target and change the www CNAME
   to `primuslab-web.onrender.com`. Preserve unrelated DNS records/nameservers.
4. Verify the domain and HTTPS certificate in Render before switching sign-in.
5. In Supabase, allow the exact redirect
   `https://primustrader.co.uk/auth/callback`; keep the old callback for rollback.
   Set Site URL to `https://primustrader.co.uk`.
6. Set Render's public origin to `https://primustrader.co.uk` and redeploy.
7. Update Google Branding homepage/privacy links and authorized domain. Google's
   OAuth client redirect remains Supabase's callback, which does not change:
   `https://gelimppzfstfnwdrlndp.supabase.co/auth/v1/callback`.
8. Test real owner sign-in, private API protection, imports/navigation/backups,
   and old-host redirects. Existing data and Google-subject bindings are retained.

## Wix values observed before the change

- Root A: `185.230.63.171`, `185.230.63.186`, `185.230.63.107`, TTL 1 hour.
- www CNAME: `initial.wixdns.net`, TTL 1 hour.
- Nameservers: `ns12.wixdns.net`, `ns13.wixdns.net`.

These describe the original parked Wix domain, for rollback if needed. Confirm
the live record state before making or reversing any DNS changes. DNS propagation
and registration confirmation can delay the cutover.
