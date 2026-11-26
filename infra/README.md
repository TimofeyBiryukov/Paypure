# Paypure deployment (home server)

Ansible deploys Paypure to `admin@192.168.1.60` (Raspberry Pi, arm64) into
`~/Releases/paypure`. Everything on the server comes from this folder: compose file, `.env`, DB
roles, seed data, migrations, backup script and cron job. Don't edit anything on the server by
hand. Change it here and re-run the deploy.

The app is at `http://<server>:3000`, on localhost, the LAN and Tailscale
(`http://100.86.233.38:3000`). Only the client publishes a port. Postgres, the API and Gotenberg
stay on the stack's internal network.

## One-time setup

- `infra/ansible/.vault-pass` holds the vault password. It is git-ignored, so keep a copy in your
  password manager. Without it, `group_vars/homeserver/vault.yml` can't be decrypted.
- Your SSH key must work for `admin@192.168.1.60`. No sudo is needed: `admin` is in the `docker`
  group.

## Deploy

Run from `infra/ansible`. The first time, snapshot the local dev DB (it becomes the server's
starting data):

```bash
ansible-playbook snapshot.yml
```

```bash
ansible-playbook deploy.yml
```

What `deploy.yml` does:
1. Preflight: checks arm64, docker access, ≥3 GB free disk and the port, and records the other
   running containers.
2. The version is the git short sha. A dirty tree is refused unless you pass
   `-e allow_dirty=true`.
3. If the server doesn't have that version yet, it builds `linux/arm64` images locally with buildx,
   copies them over as one tarball and runs `docker load`.
4. Templates `docker-compose.yml`, `.env` (0600) and `backup.sh`.
5. Starts postgres and creates or updates the `paypure_app` role and its grants. **If the DB is
   empty**, it restores `files/seed/paypure.dump`. Then it runs migrations (`api-migrate`).
6. `docker compose up -d --wait`, then removes old paypure images, keeping the last 2.
7. Installs the nightly backup cron job at 03:30.
8. Verify: `/login` returns 200, all containers are healthy, `timofeybiryukov@gmail.com` is an
   active admin, and the other services are still running.

It's safe to re-run. The seed is restored only into an empty database, never over existing data.

| Option | Effect |
|---|---|
| `-e allow_dirty=true` | Deploy uncommitted changes (tag `<sha>-dirty-<hash>`) |
| `-e run_backup_now=true` | Run `backup.sh` once at the end |
| `-e paypure_reset_db=yes-destroy-data` | **Deletes all server data** and restores the seed again |
| `--tags config,up` | Only re-template config and restart (e.g. after a vault change) |

## Secrets

`group_vars/homeserver/vault.yml` (ansible-vault): `vault_postgres_password`,
`vault_app_db_password`, `vault_session_secret`, `vault_print_signing_secret` and `vault_smtp_pass`
(Gmail App Password, see `docs/email-setup.md`).

```bash
ansible-vault edit group_vars/homeserver/vault.yml
```

Changing `vault_app_db_password` takes effect on the next deploy (the role password is re-applied
every run). `vault_postgres_password` is only read when the volume is first created. To change it
later, `ALTER ROLE paypure` first.

Email is real Gmail SMTP, but `MAIL_REDIRECT_TO` (in `vars.yml`) sends every email to you. Remove
it from `vars.yml` and redeploy once you want clients to receive them.

## Backups

`~/Releases/paypure/backups/`: `daily-YYYY-MM-DD.dump` (7 kept) and `weekly-*.dump` (4, Sundays),
with a log in `backup.log`. **They are on the Pi's SD card only.** Copying them off the box is a
follow-up.

Restore one (this replaces the data): run `deploy.yml` with
`-e paypure_reset_db=yes-destroy-data` after replacing `files/seed/paypure.dump` with the backup
file.

## Rollback

The previous image version stays on the server. Check out that commit and run
`ansible-playbook deploy.yml`. The images already exist there, so nothing is rebuilt. Migrations
only go forward, so rolling back past a migration needs a DB restore.
