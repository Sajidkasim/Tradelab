# PrimusLab team website

The app now supports one owner and four invited teammates. Each person has a private
workspace. Sharing is off by default; when enabled, the Team page shows results and
strategy names, not notes, screenshots, account details or editable trade forms.

## Use the local app

Run `./run.sh` (Mac) or `run.bat` (Windows). Local mode requires the explicit
`PRIMUSLAB_LOCAL_ONLY=1` flag and a server bound to `127.0.0.1`. It is for your own
computer, not for hosting behind a public proxy. The default website path requires
Google login and fails closed if login has not been configured.

Open **Team** and enter the owner's Google email. You can then add each teammate's
name and Google email under **Manage team**. Adding someone records an invitation;
it does not send an email. Send the website link yourself when the site is ready.

## Connect Google sign-in

Follow [Streamlit's official Google sign-in setup](https://docs.streamlit.io/develop/tutorials/authentication/google)
to create a Google OAuth web client. Register the exact callback URL:

- Local sign-in test: `http://localhost:8502/oauth2callback`
- Website: `https://YOUR-WEBSITE/oauth2callback`

While the Google app is in testing, add all five Google accounts as Google test users.
PrimusLab also checks its own invitation list; a successful Google login alone does
not grant access. Google must return a verified email and a stable account identifier.

Put the following in `.streamlit/secrets.toml` locally, or the hosting provider's
Streamlit secrets interface. Never commit that file or paste the actual secrets into chat.

```toml
PRIMUSLAB_OWNER_EMAIL = "YOUR-GOOGLE-EMAIL"
TRADELAB_DB_URL = "YOUR-DATABASE-CONNECTION"

[auth]
redirect_uri = "https://YOUR-WEBSITE/oauth2callback"
cookie_secret = "GENERATE-A-LONG-RANDOM-SECRET"
client_id = "YOUR-GOOGLE-CLIENT-ID"
client_secret = "YOUR-GOOGLE-CLIENT-SECRET"
server_metadata_url = "https://accounts.google.com/.well-known/openid-configuration"
```

The owner email must match the owner already configured in the database. Generate a
cookie secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"` on
your own computer. Use a fresh secret for the deployed site.

Install `requirements.txt`, which includes Authlib. For hosting, **do not use run.sh**;
unset `PRIMUSLAB_LOCAL_ONLY` and start with:

```bash
streamlit run app.py --server.address 0.0.0.0
```

Use HTTPS on the website. If deploying to Streamlit Community Cloud, override the
repository's loopback `server.address` for the host and configure these secrets before
opening access. The current work has not published a site or created a Google OAuth client.

## Data and permissions

- The owner retains the existing database and trades. There is no automatic reassignment.
- SQLite stores teammates under `data/members/` next to the owner's database. Use a
  persistent volume and back up that directory plus the owner's database.
- On Postgres, teammates use separate `primus_<member-id>` schemas. Every trade query,
  update and backup is schema-qualified. The database role needs permission to create
  schemas. Test this against the intended hosted database before inviting the team;
  the automated end-to-end storage tests run against SQLite.
- Each member's in-app backup contains only their workspace. Team invitations and
  sharing preferences live in the separate `primus_members` table; include it in
  administrator backups. Never expose the database directly to browser clients.
- Only the owner can use server-configured broker credentials. Teammates import their
  own files. The nightly script continues to write only to the owner's original database.
- Pausing a teammate's access takes effect on subsequent requests and clears their
  sharing choice. It preserves their journal. Re-enabling them does not re-enable sharing.
- All browses backtesting and forward histories without demo trades. Statistical
  views require one testing type at a time, and team comparisons show separate rows.

## Before sending the team the link

Test owner login, one invited account and an uninvited account on the deployed site.
Confirm that the invited account starts empty, cannot use the owner's broker connection,
cannot see private results, and loses access after being paused. Verify backup/restore
and persistent storage with the actual host. A real Google redirect cannot be tested
until the OAuth client, callback URL and secrets are supplied.
