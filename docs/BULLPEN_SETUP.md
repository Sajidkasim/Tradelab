# Live Trading Bullpen

The feature starts disabled. Render issues access credentials. The Jitsi
deployment handles media and Supabase Realtime handles presence and ephemeral
chat. Messages are not replayed to people who join later. No broker, journal
or trade data is sent to either service. The Trade Feed accepts an optional list
of {id, label} entries and is currently empty.

## Frontend

From the repository root:

```sh
cd frontend
npm install @jitsi/react-sdk @supabase/supabase-js
npm run build
```

Both dependencies are included in the package and lock files, so existing
checkouts can use npm ci.

## Private services

1. Use a trusted, TLS-enabled Jitsi deployment with token authentication
   required for **all** participants, no anonymous guest access, and empty
   tokens disabled. Configure the issuer to accept the app ID, the audience
   to accept jitsi, and the subject to match the meeting domain. Match the
   app secret on both servers. The JWT is restricted to
   PrimusLab-Live-Trading-Floor. Verify directly that opening that room URL
   without a JWT cannot join. Never use the public meet.jit.si service for
   this fixed room. Jitsi's external API script runs on the Primus page, so
   only use a host you administer or trust. Configure any remaining branding
   and iframe colors on the Jitsi host for the installed Jitsi version.
2. Apply BULLPEN_REALTIME.sql to the existing Supabase project. Disable
   **Allow public access** in Realtime settings to prevent public connections
   to the topic. Review any unrelated existing channels before changing this
   project-wide setting. Verify that an ordinary authenticated user cannot
   join the private topic. Use the project's legacy JWT signing secret only
   if enabled and accepted by your Realtime configuration. Keep it server-side.
   The Bullpen role must have no grants to application tables.
3. In Render set BULLPEN_JITSI_DOMAIN (hostname only),
   BULLPEN_JITSI_APP_ID, BULLPEN_JITSI_APP_SECRET, and
   BULLPEN_SUPABASE_JWT_SECRET. Set BULLPEN_SAJID_EMAIL, BULLPEN_SAFWAAN_EMAIL,
   BULLPEN_MUBEEN_EMAIL, BULLPEN_MUSTAFA_EMAIL, and BULLPEN_AMIR_EMAIL to the
   exact verified Google addresses. Each falls back to the corresponding
   COACH_*_EMAIL when omitted. Use a different secret for each service.
4. After verifying both private access checks, set BULLPEN_ENABLED=1 and
   deploy. Sign in to Learn on two team accounts to test video, screen share,
   presence, chat and Leave Call. The LIVE badge reflects joined participants
   and appears in the shared site navigation for eligible team members.

Chat and reaction events are shared with the private team channel. Member names
are derived from verified sign-in when the app issues credentials. Jitsi
moderation, screen-sharing resolution and bandwidth depend on the host and
browser. Rotating the Supabase signing secret affects other uses of that secret
in the project.
