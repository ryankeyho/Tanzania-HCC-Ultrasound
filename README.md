# Liver POCUS Course, Web Application

A self-contained account-based training platform: registration/login,
server-side-graded quizzes (all 337 questions from the verified Moodle
banks), progress tracking, and an instructor dashboard with CSV export.

Built to replace a static-site + Moodle approach with something you
fully control, deployable on a single small server.

## What was actually tested, and how

Not just written, run. Two things you should know before trusting this:

1. **The backend** was exercised with a real Python `requests` client
   against a live server: registration, duplicate/wrong-password
   rejection, section-quiz immediate feedback and unlimited retakes,
   exam-mode answers withheld until submission, the single-attempt lock
   (blocking both a second start *and* a resubmit), progress tracking,
   admin access control, and CSV export. All passed.

2. **The frontend** was exercised via `jsdom` executing the actual
   `<script>` files against the actual served HTML, with a real cookie
   jar so sessions persist across requests the way a browser's would ,
   not a full rendering browser (no layout/CSS engine was available in
   the build sandbox), but genuine JS execution, not just a code read.
   37 checks across two test files, all passing. See `jstest/`, rerun
   them yourself with `node jstest/real_dom_test.js` against a running
   server if you change anything.

Three real bugs were caught and fixed this way, not left for you to
find: a datetime deprecation, section-quiz attempts never being marked
complete server-side (meaning they silently never appeared in progress
or the dashboard), and a WSGI/gunicorn path issue. Several more
"failures" during testing turned out to be bugs in the *tests*
(timing, string comparison) rather than the app, noted in the test
files' commit history of fixes, in case you extend them later.

## Structure

```
app/
  server.py          Flask app, routes, auth, quiz logic, admin API
  schema.sql          Database schema
  static/             Everything served to the browser
    index.html, login.html, register.html, progress.html, admin.html, quiz.html
    pages/            The 15 course content pages
    css/site.css       Site chrome (nav, forms, quiz UI)
    js/                api.js, quiz-runner.js, course-structure.js
    images/            The 63 course images
    branding/          Logo assets (not yet wired into the UI, see note below)
init_db.py             One-time (and re-runnable) question bank importer
source_qbanks/         The 11 verified Moodle XML files init_db.py reads
wsgi.py                Production entry point for gunicorn
requirements.txt
deploy/
  DEPLOY-AWS.md        Full walkthrough, Lightsail/EC2, tested commands
  liverpocus.service   systemd unit
  nginx-http-only.conf  For initial testing before you have a domain
  nginx-https.conf      Reference for what Certbot produces
jstest/                 The real-DOM test suite described above
```

## Quick start (local testing, not production)

```bash
cd app
python3 -m venv venv && source venv/bin/activate
pip install -r ../requirements.txt
cd ..
python3 init_db.py        # prompts for an admin account on first run
cd app
python3 server.py         # http://127.0.0.1:5000, dev server, not for real use
```

For an actual deployment, use `deploy/DEPLOY-AWS.md`, it's a different
process (gunicorn + nginx + systemd), not just "run this in prod too."

## Design

Dark theme integrated throughout, matching the course logo, sampled its
actual pixel colors rather than eyeballing them: gold `#FFFF03`, cyan
`#00F6FE`, green `#03FF3C`. Full neon is used for the header brand glow
and section-number accents; everyday UI (buttons, links, text) uses
toned-down versions of the same hues, because full neon on dark for
body text you're reading for hours causes real eye strain.

**Background is dark grey (`#14161A`), deliberately not black.**
Ultrasound images already have black borders and near-black anechoic
regions of their own; a black page background sitting right up against
that causes simultaneous contrast, the image's blacks look artificially
"lifted" because the eye references them against an even-darker
surround. A grey surround is standard practice in PACS/DICOM viewers for
exactly this reason. Every color pairing (text-on-background,
button-on-background, muted text, etc.) was checked against WCAG
contrast requirements programmatically, all pass with real margin, most
by 2-3x the minimum.

The 15 course content pages now link a single shared stylesheet
(`content-dark.css`) instead of each embedding its own copy, page sizes
dropped 15-30% as a result, and a future color tweak now means one edit
instead of fifteen. The Moodle-facing source files (if you still need
them) are untouched and keep their original light/warm-paper theme,
which is a different, deliberately more printable design for that
context.

No web font dependency was added, given likely low-connectivity
deployment, relying on a Google Fonts CDN at page-load felt like the
wrong tradeoff for how little it would add. The retro feel comes from
color, weight, letter-spacing and glow effects on the existing system
font stack instead.

## The animated logo

Implemented on **login, register, and the course home page only**, not
on the 15 content pages, and that's a deliberate scoping decision worth
knowing about rather than an oversight.

The GIF is a CRT "power-on" boot sequence (117 frames, ~6.2s) that
resolves cleanly into the static logo, confirmed by extracting frames
before using it. Optimized with `gifsicle` from 9.5MB to 5.4MB (lossy
compression, same 117 frames, no visible quality loss at this size).

It plays once and then swaps to the static PNG (`boot-logo.js`) ,
deliberately not relying on the GIF's own loop-count metadata, since
browsers are inconsistent enough about GIF looping that it isn't worth
trusting; the swap is done on a plain timer matched to the real
animation duration instead.

**Why not on the 15 content pages:** those get revisited constantly
while studying, and a repeating animation in a persistent header would
be a genuine distraction during focused reading or a timed quiz, not
just an aesthetic call, but the same reasoning behind avoiding full-neon
color for body text. Login/register/home are each seen once per
session, which is exactly where a "boot up" moment belongs.

## Known limitations, stated plainly

- No email, password resets are instructor-assisted (see the admin
  dashboard), which is fine at this cohort size and not fine much past it.
- SQLite, not Postgres, correct choice at this scale, a real migration
  if the program ever grows far beyond it.
- No automated backups configured, the command is documented, the cron
  job is yours to add.
- The visual design is functional, not the retro branded look you've
  shown me, by design, pending the pass noted above.
