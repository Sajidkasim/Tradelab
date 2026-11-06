# Live Trading Bullpen

The feature starts disabled. Render issues access credentials. The Jitsi
deployment handles media and Supabase Realtime handles presence and ephemeral
chat. Messages are not replayed to people who join later. No broker, journal
or trade data is sent to either service. The Trade Feed accepts an optional list
of {id, label} entries and is currently empty.

## Frontend

From the repository root:


```

Both dependencies are included in the package and lock files, so existing
checkouts can use npm ci.

## JaaS video and private team chat

1. Create a JaaS Dev project at https://jaas.8x8.vc/ and create an API key
   in its console. Save the private PEM when generated and keep it private.
2. In Render set BULLPEN_JAAS_APP_ID to the project App ID,
   BULLPEN_JAAS_KEY_ID to the full key ID (including the App ID prefix and
   slash), and BULLPEN_JAAS_PRIVATE_KEY to the complete private PEM.
   These values stay on the server.
3. Keep the existing Supabase Realtime policy, signing secret and exact team
   email settings. For a fresh project, apply BULLPEN_REALTIME.sql and verify
   an ordinary authenticated user cannot access the private channel. Review
   existing channels before disabling **Allow public access** in Realtime.
4. Set BULLPEN_ENABLED=1, deploy, then open Learn with two approved Google
   accounts. The Primus owner receives moderator privileges. Verify the
   owner can start a call, another teammate can join, and screen sharing
   stays connected beyond five minutes.

Primus issues a short-lived JaaS JWT tied to the exact room, using the
authenticated workspace identity. Render does not process media. There is
no public Jitsi fallback in this build. If the JaaS settings are missing or
invalid, the Join button remains disabled.
