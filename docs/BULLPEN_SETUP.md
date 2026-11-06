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

## Public video trial and private team chat

1. Apply BULLPEN_REALTIME.sql to the existing Supabase project. Disable
   **Allow public access** in Realtime settings to prevent public connections
   to the topic. Review unrelated channels before changing this project-wide
   setting. Verify an ordinary authenticated user cannot join the topic.
   Use the legacy JWT signing secret only if accepted by your Realtime
   configuration. Keep the secret server-side and grant the Bullpen role
   access to Realtime only.
2. In Render set BULLPEN_SUPABASE_JWT_SECRET and the five exact Google addresses
   BULLPEN_SAJID_EMAIL, BULLPEN_SAFWAAN_EMAIL, BULLPEN_MUBEEN_EMAIL,
   BULLPEN_MUSTAFA_EMAIL, and BULLPEN_AMIR_EMAIL. Each falls back to the
   corresponding COACH_*_EMAIL. Set BULLPEN_ENABLED=1 after checking the
   Realtime policy. This setup requires no Jitsi JWT or Jitsi environment variables.
3. Sign in to Learn on two team accounts. Try video, screen sharing, presence,
   chat and Leave Call. Public Jitsi requires a signed-in moderator to start
   the room. Use Open in Jitsi if public hosting blocks or limits the embed.

The room name is derived from the server secret and returned only to verified
team members opening the room. If the link is shared, the Primus login cannot
protect the public Jitsi room. Use Jitsi's lobby where available. Change
BULLPEN_ROOM_VERSION to a new value and restart the service to rotate the name.
This does not terminate a call already running at the old link.

Jitsi documents public embedding for integration testing. Treat this setup as
a trial. Jitsi controls meeting duration, authentication, and branding.
