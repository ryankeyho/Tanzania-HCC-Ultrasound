# Deploying to AWS

Tested against: Ubuntu 24.04, Python 3.12, the exact package versions in
`requirements.txt`. Every command below was actually run against this
codebase during development — this isn't a generic tutorial adapted for
the project, it's what building it required.

## 0. Which AWS service

**Lightsail** is the recommended default: a fixed $5/month plan gets you
a small Ubuntu VM with full root access — enough for this app's scale
(a cohort of 8-15 trainees) many times over. It is real EC2 underneath,
just with simpler billing and networking defaults, and you can graduate
to a plain EC2 instance later with no code changes.

**EC2 free tier** (`t3.micro`, 12 months free) is the zero-cost
alternative if you'd rather start there. Slightly more setup (VPC,
security groups from scratch) but identical from this point on — same
Ubuntu, same commands.

Either way you want: **Ubuntu 24.04 LTS**, at least 1 GB RAM (the
smallest Lightsail plan and `t3.micro` both qualify), and a static IP
(Lightsail: attach one free of charge under Networking; EC2: allocate
an Elastic IP).

## 1. Launch and connect

Lightsail: **Create instance** → Linux/Unix → OS Only → Ubuntu 24.04 →
smallest plan → name it → Create. Then **Networking** tab → attach a
static IP. Connect via the browser SSH button, or download the default
key and:

```bash
ssh -i LightsailDefaultKey.pem ubuntu@YOUR_STATIC_IP
```

## 2. Base packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv python3-pip nginx sqlite3 unzip
```

## 3. Create a dedicated user

Never run application code as root or as your login user.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin liverpocus
sudo mkdir -p /opt/liverpocus-webapp /var/log/liverpocus
sudo chown liverpocus:liverpocus /opt/liverpocus-webapp /var/log/liverpocus
```

## 4. Upload the app

From your own machine, not the server:

```bash
scp -i LightsailDefaultKey.pem liverpocus-webapp.zip ubuntu@YOUR_STATIC_IP:/tmp/
```

Back on the server:

```bash
sudo unzip /tmp/liverpocus-webapp.zip -d /opt/liverpocus-webapp
sudo chown -R liverpocus:liverpocus /opt/liverpocus-webapp
```

## 5. Python environment

```bash
cd /opt/liverpocus-webapp
sudo -u liverpocus python3 -m venv venv
sudo -u liverpocus venv/bin/pip install -r requirements.txt
```

## 6. Secrets

```bash
sudo -u liverpocus python3 -c "import secrets; print(secrets.token_hex(32))"
```

Copy that output, then:

```bash
sudo -u liverpocus tee /opt/liverpocus-webapp/.env << 'EOF'
SECRET_KEY=paste-the-generated-hex-string-here
FORCE_HTTPS=1
EOF
sudo chmod 600 /opt/liverpocus-webapp/.env
```

`FORCE_HTTPS=1` makes session cookies `Secure` — they will only be sent
over HTTPS. Leave this set to `1` even before you've set up HTTPS (step
9); until then, login simply won't work over plain HTTP, which is the
correct failure mode rather than silently sending a password in the
clear. Flip it to `0` only for brief local troubleshooting.

## 7. Import the question banks and create the first admin account

The 11 `qbank-*.xml` files are already inside the zip, in
`source_qbanks/`.

```bash
cd /opt/liverpocus-webapp
sudo -u liverpocus venv/bin/python3 init_db.py
```

This prompts for an admin name, email, and password interactively —
that becomes your instructor login. Re-running `init_db.py` later
re-imports questions (safe, idempotent) but will not prompt again once
`liverpocus.db` exists, and never touches existing user accounts or
quiz attempts.

## 8. systemd service

```bash
sudo cp deploy/liverpocus.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now liverpocus
sudo systemctl status liverpocus
```

You should see `active (running)`. Check the logs if not:

```bash
sudo journalctl -u liverpocus -n 50 --no-pager
```

## 9. Nginx — HTTP first, HTTPS once you have a domain

Start with plain HTTP to confirm everything works end to end:

```bash
sudo cp deploy/nginx-http-only.conf /etc/nginx/sites-available/liverpocus
sudo ln -s /etc/nginx/sites-available/liverpocus /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Visit `http://YOUR_STATIC_IP` — you should reach the login page. **Do
not have trainees log in yet** — with `FORCE_HTTPS=1` set, login will
actually be *rejected* over plain HTTP (the secure cookie can't be set),
which you'll see as a login that silently doesn't redirect. That is
deliberate, not a bug: it stops the plain-HTTP version from being used
for anything beyond confirming that pages load.

### Once you have a domain

Point an A record at your static IP, wait for DNS to propagate
(`dig your-domain.org` should show the IP), then:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.org
```

Certbot edits your nginx config in place and reloads it — you don't
need to manually apply `nginx-https.conf`; it's included so you can see
what the result should look like. Certificates auto-renew via a systemd
timer Certbot installs; confirm it exists with:

```bash
sudo systemctl list-timers | grep certbot
```

## 10. Firewall

Lightsail: **Networking** tab → allow TCP 80 and 443, remove anything
else you don't need. EC2: same via the instance's Security Group. Do
**not** open port 8000 (gunicorn) or 5000 to the internet — nginx is
the only thing that should be reachable directly; gunicorn binds to
127.0.0.1 only, which the systemd unit and this firewall rule together
enforce.

## 11. Confirm it's actually working

```bash
curl -I https://your-domain.org/
curl -s https://your-domain.org/api/me
```

The first should return `200`; the second `{"user":null}` if you're not
logged in. Then log in through the actual browser as the admin account
from step 7, confirm the dashboard loads, and register a throwaway
trainee account to confirm the full signup → quiz → progress flow.

## Backups

Everything live is one file: `/opt/liverpocus-webapp/app/liverpocus.db`.

```bash
sudo -u liverpocus sqlite3 /opt/liverpocus-webapp/app/liverpocus.db ".backup /tmp/liverpocus-backup-$(date +%F).db"
```

Put that on a cron job and copy the result somewhere off the server
(S3, or just `scp` it out weekly) — a `.backup` snapshot is safe to take
while the app is running, unlike copying the `.db` file directly.

## Updating the question banks later

If a bank changes (a correction, a new section):

```bash
# replace the changed file(s) in source_qbanks/, then:
sudo -u liverpocus venv/bin/python3 init_db.py
sudo systemctl restart liverpocus
```

This replaces questions for the changed quiz only; it does not touch
user accounts or already-recorded attempts.

## What this deployment does not include

- **Email.** No password-reset-by-email, no notification emails. The
  admin dashboard's password reset is instructor-assisted by design —
  fine for a small, known cohort; would need revisiting past maybe
  50-100 users.
- **Automated backups.** The command above is manual; wire it into cron
  or a Lightsail snapshot schedule yourself.
- **Horizontal scaling.** SQLite and 2 gunicorn workers comfortably
  cover this cohort size. If this ever needs to serve a much larger,
  concurrent, multi-cohort population, that's a real re-architecture
  (Postgres, more workers, possibly a load balancer) — not a
  configuration change.
