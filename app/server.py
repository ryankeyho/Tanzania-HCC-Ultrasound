"""
Liver POCUS course, application server.

A small Flask app: username/password accounts, server-side-graded quizzes,
and an instructor dashboard. Designed to run behind gunicorn + nginx on a
single small server (see deploy/DEPLOY-AWS.md), SQLite is intentionally
used instead of a managed database, because this scale (tens to low
hundreds of trainees) does not need one, and it removes a whole service
you would otherwise have to run, secure and pay for.
"""
import os
import json
import sqlite3
import secrets
import functools
import csv
import io
from datetime import datetime, timezone

from flask import (
    Flask, g, request, session, jsonify, send_from_directory,
    redirect, url_for, Response, abort
)
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "liverpocus.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="/static")

# SECRET_KEY signs the session cookie. In production this MUST come from
# the environment (see deploy docs), never commit a real key.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-only-insecure-key-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Secure cookies require HTTPS. The deploy docs put nginx + Let's Encrypt in
# front of this app; SESSION_COOKIE_SECURE is driven by an env var so local
# testing over plain http still works.
app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FORCE_HTTPS", "0") == "1"

RATE_LIMIT = {}  # naive in-memory login rate limiter: {email: [timestamps]}
RATE_LIMIT_WINDOW_S = 300
RATE_LIMIT_MAX_ATTEMPTS = 8

# A single shared reviewer account, not a real trainee. Its quiz progress is
# wiped every time someone starts a new guest session and again on logout,
# so no reviewer's clicking-around persists for the next person, and it is
# excluded from admin views so it never pollutes real trainee records.
GUEST_EMAIL = "guest@demo.local"


def ensure_guest_user(db):
    row = db.execute("SELECT id FROM users WHERE email = ?", (GUEST_EMAIL,)).fetchone()
    if row:
        return row["id"]
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash, role, cohort) VALUES (?,?,?,?,?)",
        ("Guest Reviewer", GUEST_EMAIL, generate_password_hash(secrets.token_urlsafe(32)), "trainee", None),
    )
    db.commit()
    return cur.lastrowid


def wipe_guest_progress(db, guest_id):
    # schema.sql sets no ON DELETE CASCADE on attempt_answers.attempt_id, and
    # foreign_keys = ON, so child rows must be removed before their parent
    # attempts or this violates the constraint.
    db.execute(
        "DELETE FROM attempt_answers WHERE attempt_id IN "
        "(SELECT id FROM attempts WHERE user_id = ?)", (guest_id,)
    )
    db.execute("DELETE FROM attempts WHERE user_id = ?", (guest_id,))
    db.commit()


# ---------------------------------------------------------------- database
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


# ---------------------------------------------------------------- csrf
# Double-submit cookie pattern: no extra dependency, works for a same-origin
# fetch()-based frontend. A CSRF token is issued on login and must be echoed
# back in the X-CSRF-Token header on every state-changing request.
def issue_csrf_token():
    token = secrets.token_urlsafe(32)
    session["csrf"] = token
    return token


def require_csrf():
    token = request.headers.get("X-CSRF-Token", "")
    if not token or token != session.get("csrf"):
        abort(403, description="Missing or invalid CSRF token")


# ---------------------------------------------------------------- auth helpers
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    row = get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()
    return row


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        if current_user() is None:
            return jsonify(error="not authenticated"), 401
        return fn(*a, **kw)
    return wrapper


def role_required(*roles):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*a, **kw):
            u = current_user()
            if u is None:
                return jsonify(error="not authenticated"), 401
            if u["role"] not in roles:
                return jsonify(error="forbidden"), 403
            return fn(*a, **kw)
        return wrapper
    return deco


# ---------------------------------------------------------------- auth routes
@app.post("/api/register")
def register():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    cohort = (data.get("cohort") or "").strip() or None

    if not name or not email or len(password) < 8:
        return jsonify(error="name, email and an 8+ character password are required"), 400

    db = get_db()
    exists = db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone()
    if exists:
        return jsonify(error="an account with that email already exists"), 409

    db.execute(
        "INSERT INTO users (name, email, password_hash, role, cohort) VALUES (?,?,?,?,?)",
        (name, email, generate_password_hash(password), "trainee", cohort),
    )
    db.commit()
    return jsonify(ok=True)


@app.post("/api/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    now = datetime.now(timezone.utc).timestamp()
    attempts = [t for t in RATE_LIMIT.get(email, []) if now - t < RATE_LIMIT_WINDOW_S]
    if len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS:
        return jsonify(error="too many attempts, try again later"), 429

    row = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not check_password_hash(row["password_hash"], password):
        attempts.append(now)
        RATE_LIMIT[email] = attempts
        return jsonify(error="invalid email or password"), 401

    RATE_LIMIT.pop(email, None)
    session.clear()
    session["user_id"] = row["id"]
    token = issue_csrf_token()
    return jsonify(ok=True, csrf=token, user={
        "id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"],
    })


@app.post("/api/guest-login")
def guest_login():
    db = get_db()
    guest_id = ensure_guest_user(db)
    wipe_guest_progress(db, guest_id)  # fresh start for every reviewer
    row = db.execute("SELECT * FROM users WHERE id = ?", (guest_id,)).fetchone()
    session.clear()
    session["user_id"] = row["id"]
    session["is_guest"] = True
    token = issue_csrf_token()
    return jsonify(ok=True, csrf=token, user={
        "id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"],
    })


@app.post("/api/logout")
@login_required
def logout():
    if session.get("is_guest"):
        wipe_guest_progress(get_db(), session["user_id"])
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    u = current_user()
    if not u:
        return jsonify(user=None)
    return jsonify(user={"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"]},
                    csrf=session.get("csrf"))


# ---------------------------------------------------------------- quiz routes
@app.get("/api/quizzes")
@login_required
def list_quizzes():
    db = get_db()
    quizzes = db.execute("SELECT id, title, mode, sort_order FROM quizzes ORDER BY sort_order").fetchall()
    uid = current_user()["id"]
    out = []
    for q in quizzes:
        count = db.execute("SELECT COUNT(*) c FROM questions WHERE quiz_id=?", (q["id"],)).fetchone()["c"]
        best = db.execute(
            "SELECT score, total, completed_at FROM attempts "
            "WHERE user_id=? AND quiz_id=? AND completed_at IS NOT NULL "
            "ORDER BY score DESC, completed_at DESC LIMIT 1",
            (uid, q["id"]),
        ).fetchone()
        out.append({
            "id": q["id"], "title": q["title"], "mode": q["mode"], "item_count": count,
            "best_score": (dict(best) if best else None),
        })
    return jsonify(quizzes=out)


@app.post("/api/quiz/<quiz_id>/start")
@login_required
def start_quiz(quiz_id):
    db = get_db()
    quiz = db.execute("SELECT * FROM quizzes WHERE id=?", (quiz_id,)).fetchone()
    if not quiz:
        return jsonify(error="no such quiz"), 404
    uid = current_user()["id"]

    if quiz["mode"] == "exam":
        prior = db.execute(
            "SELECT 1 FROM attempts WHERE user_id=? AND quiz_id=? AND completed_at IS NOT NULL",
            (uid, quiz_id),
        ).fetchone()
        if prior:
            return jsonify(error="this quiz allows only one attempt, and you have already completed it"), 409

    rows = db.execute("SELECT id, stem, choice_a, choice_b, choice_c, choice_d FROM questions "
                       "WHERE quiz_id=? ORDER BY sort_order", (quiz_id,)).fetchall()
    if not rows:
        return jsonify(error="quiz has no questions"), 500

    order = [r["id"] for r in rows]
    secrets.SystemRandom().shuffle(order)
    by_id = {r["id"]: r for r in rows}

    cur = db.execute(
        "INSERT INTO attempts (user_id, quiz_id, order_json) VALUES (?,?,?)",
        (uid, quiz_id, json.dumps(order)),
    )
    db.commit()
    attempt_id = cur.lastrowid

    questions_out = []
    for qid in order:
        r = by_id[qid]
        choices = [r["choice_a"], r["choice_b"], r["choice_c"], r["choice_d"]]
        idx = list(range(4))
        secrets.SystemRandom().shuffle(idx)
        # shuffled_choices[i] is the text shown at position i; shuffled_choices
        # remembers which original index it came from, so we can map the
        # user's selected position back to a/b/c/d when scoring.
        questions_out.append({
            "question_id": qid,
            "stem": r["stem"],
            "choices": [choices[i] for i in idx],
            "position_map": idx,   # NOT sent in section-mode responses that include answers pre-shuffle; safe here since it maps position->original index, not the answer itself
        })

    return jsonify(attempt_id=attempt_id, mode=quiz["mode"], questions=questions_out)


@app.post("/api/quiz/attempt/<int:attempt_id>/answer")
@login_required
def answer_question(attempt_id):
    """Used by SECTION-mode quizzes for immediate per-question feedback."""
    db = get_db()
    uid = current_user()["id"]
    attempt = db.execute("SELECT * FROM attempts WHERE id=? AND user_id=?", (attempt_id, uid)).fetchone()
    if not attempt:
        return jsonify(error="no such attempt"), 404
    quiz = db.execute("SELECT * FROM quizzes WHERE id=?", (attempt["quiz_id"],)).fetchone()

    data = request.get_json(force=True, silent=True) or {}
    qid = data.get("question_id")
    selected_original_index = data.get("selected")  # 0-3, already mapped back to a/b/c/d by the client using position_map

    q = db.execute("SELECT * FROM questions WHERE id=? AND quiz_id=?", (qid, attempt["quiz_id"])).fetchone()
    if not q or selected_original_index not in (0, 1, 2, 3):
        return jsonify(error="invalid question or answer"), 400

    is_correct = 1 if selected_original_index == q["correct"] else 0
    db.execute(
        "INSERT INTO attempt_answers (attempt_id, question_id, selected, is_correct) VALUES (?,?,?,?)",
        (attempt_id, qid, selected_original_index, is_correct),
    )
    db.commit()

    resp = {"correct": bool(is_correct)}
    # Section quizzes are formative: reveal the right answer and rationale immediately.
    if quiz["mode"] == "section":
        resp["correct_index"] = q["correct"]
        resp["rationale"] = q["rationale"]
    return jsonify(resp)


@app.post("/api/quiz/attempt/<int:attempt_id>/finish")
@login_required
def finish_section_attempt(attempt_id):
    """
    Section-mode attempts are scored one question at a time via /answer,
    which never marks the attempt itself complete. Without this call,
    formative attempts silently never appear in /api/progress or the
    instructor dashboard, nobody can see whether a trainee engaged with
    the section quizzes at all. The frontend calls this once every
    question in the attempt has been answered.
    """
    db = get_db()
    uid = current_user()["id"]
    attempt = db.execute("SELECT * FROM attempts WHERE id=? AND user_id=?", (attempt_id, uid)).fetchone()
    if not attempt:
        return jsonify(error="no such attempt"), 404
    if attempt["completed_at"] is not None:
        return jsonify(ok=True)  # already finished; idempotent

    order = json.loads(attempt["order_json"])
    rows = db.execute(
        "SELECT question_id, is_correct FROM attempt_answers WHERE attempt_id=?", (attempt_id,)
    ).fetchall()
    answered_ids = {r["question_id"] for r in rows}
    if answered_ids != set(order):
        return jsonify(error="not all questions in this attempt have been answered yet"), 400

    score = sum(1 for r in rows if r["is_correct"])
    db.execute(
        "UPDATE attempts SET completed_at = datetime('now'), score=?, total=? WHERE id=?",
        (score, len(order), attempt_id),
    )
    db.commit()
    return jsonify(ok=True, score=score, total=len(order))


@app.post("/api/quiz/attempt/<int:attempt_id>/submit")
@login_required
def submit_attempt(attempt_id):
    """
    Used by EXAM-mode quizzes: the client sends all answers at once, scoring
    happens here, and nothing about correctness is revealed until this call
    returns. This is the part that cannot be done safely in the browser ,
    the answer key never reaches the client until after grading.
    """
    db = get_db()
    uid = current_user()["id"]
    attempt = db.execute("SELECT * FROM attempts WHERE id=? AND user_id=?", (attempt_id, uid)).fetchone()
    if not attempt:
        return jsonify(error="no such attempt"), 404
    if attempt["completed_at"] is not None:
        return jsonify(error="attempt already submitted"), 409

    data = request.get_json(force=True, silent=True) or {}
    answers = data.get("answers", [])  # [{question_id, selected}], selected already mapped to original a/b/c/d index

    order = json.loads(attempt["order_json"])
    answered = {a["question_id"]: a["selected"] for a in answers if isinstance(a.get("selected"), int)}
    if set(answered.keys()) != set(order):
        return jsonify(error="all questions must be answered before submitting"), 400

    questions = {r["id"]: r for r in db.execute(
        "SELECT * FROM questions WHERE quiz_id=?", (attempt["quiz_id"],)
    ).fetchall()}

    score = 0
    domain_note = None
    for qid, sel in answered.items():
        q = questions[qid]
        is_correct = 1 if sel == q["correct"] else 0
        score += is_correct
        db.execute(
            "INSERT INTO attempt_answers (attempt_id, question_id, selected, is_correct) VALUES (?,?,?,?)",
            (attempt_id, qid, sel, is_correct),
        )

    total = len(order)
    db.execute(
        "UPDATE attempts SET completed_at = datetime('now'), score=?, total=? WHERE id=?",
        (score, total, attempt_id),
    )
    db.commit()

    return jsonify(score=score, total=total, percent=round(100 * score / total, 1))


@app.get("/api/progress")
@login_required
def progress():
    db = get_db()
    uid = current_user()["id"]
    rows = db.execute(
        "SELECT a.quiz_id, q.title, q.mode, MAX(a.score) as best_score, a.total, "
        "       COUNT(*) as attempts, MAX(a.completed_at) as last_completed "
        "FROM attempts a JOIN quizzes q ON q.id = a.quiz_id "
        "WHERE a.user_id = ? AND a.completed_at IS NOT NULL "
        "GROUP BY a.quiz_id ORDER BY q.sort_order",
        (uid,),
    ).fetchall()
    return jsonify(progress=[dict(r) for r in rows])


# ---------------------------------------------------------------- admin routes
@app.get("/api/admin/users")
@role_required("instructor", "admin")
def admin_users():
    db = get_db()
    users = db.execute(
        "SELECT id, name, email, role, cohort, created_at FROM users WHERE email != ? ORDER BY created_at",
        (GUEST_EMAIL,),
    ).fetchall()
    out = []
    for u in users:
        attempts = db.execute(
            "SELECT quiz_id, score, total, completed_at FROM attempts "
            "WHERE user_id=? AND completed_at IS NOT NULL ORDER BY completed_at", (u["id"],)
        ).fetchall()
        out.append({**dict(u), "attempts": [dict(a) for a in attempts]})
    return jsonify(users=out)


@app.get("/api/admin/export.csv")
@role_required("instructor", "admin")
def admin_export_csv():
    db = get_db()
    rows = db.execute(
        "SELECT u.name, u.email, u.cohort, q.title as quiz, a.score, a.total, "
        "       ROUND(100.0*a.score/a.total, 1) as percent, a.completed_at "
        "FROM attempts a "
        "JOIN users u ON u.id = a.user_id "
        "JOIN quizzes q ON q.id = a.quiz_id "
        "WHERE a.completed_at IS NOT NULL AND u.email != ? "
        "ORDER BY u.name, q.sort_order",
        (GUEST_EMAIL,),
    ).fetchall()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Email", "Cohort", "Quiz", "Score", "Total", "Percent", "Completed At (UTC)"])
    for r in rows:
        w.writerow([r["name"], r["email"], r["cohort"] or "", r["quiz"], r["score"], r["total"], r["percent"], r["completed_at"]])
    return Response(buf.getvalue(), mimetype="text/csv",
                     headers={"Content-Disposition": "attachment; filename=results.csv"})


@app.post("/api/admin/reset-password")
@role_required("instructor", "admin")
def admin_reset_password():
    """No email service is configured (see deploy docs), so password resets
    are instructor-assisted rather than self-service. Fine for a small,
    known cohort; would need revisiting at larger scale."""
    require_csrf()
    data = request.get_json(force=True, silent=True) or {}
    user_id = data.get("user_id")
    new_password = data.get("new_password") or ""
    if len(new_password) < 8:
        return jsonify(error="password must be at least 8 characters"), 400
    db = get_db()
    if not db.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone():
        return jsonify(error="no such user"), 404
    db.execute("UPDATE users SET password_hash=? WHERE id=?",
               (generate_password_hash(new_password), user_id))
    db.commit()
    return jsonify(ok=True)


# require CSRF on all state-changing endpoints except login/register (no
# session yet to hold a token) and logout (no meaningful CSRF target).
@app.before_request
def csrf_gate():
    if request.method in ("POST", "PUT", "DELETE"):
        exempt = {"/api/login", "/api/register", "/api/logout", "/api/guest-login"}
        if request.path not in exempt:
            require_csrf()


# ---------------------------------------------------------------- static site
@app.get("/")
def home():
    return send_from_directory(STATIC_DIR, "index.html")


@app.get("/<path:path>")
def static_files(path):
    # Serves the course pages, login/register/dashboard pages, JS, CSS, images.
    full = os.path.join(STATIC_DIR, path)
    if os.path.isdir(full):
        abort(404)
    return send_from_directory(STATIC_DIR, path)


if __name__ == "__main__":
    app.run(debug=False, port=5000)
