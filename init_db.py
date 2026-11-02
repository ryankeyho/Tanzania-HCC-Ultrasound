"""
Builds app/liverpocus.db from schema.sql and populates it with the same
331 questions in the Moodle XML banks (qbank-*.xml).

Run once at deploy time, and again any time the source XML changes:
    python3 init_db.py

Re-running is safe for learner history. Questions are matched by their XML
ID (e.g. "Q014"). A question nobody has answered is updated in place. A
question that appears in any attempt is never edited or deleted: it is
marked retired and the new version is inserted, so past answers keep
pointing at the exact wording the learner saw. An existing database is
copied to liverpocus.db.bak-<timestamp> before any change.
"""
import sqlite3
import re
import os
import glob
import getpass
import json
import shutil
import time
from werkzeug.security import generate_password_hash
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "app", "liverpocus.db")
SCHEMA_PATH = os.path.join(HERE, "app", "schema.sql")
SOURCE_DIR = os.environ.get("QBANK_SOURCE_DIR", os.path.join(HERE, "source_qbanks"))

# (xml filename, quiz id slug, display title, mode, sort order)
QUIZZES = [
    ("qbank-pretest.xml",        "pretest",           "Pretest: Baseline Knowledge",                 "exam",    0),
    ("qbank-01-physics.xml",     "section-01",         "Session 1: Physics and Equipment",             "section", 1),
    ("qbank-02a-roadmap.xml",    "section-02a",        "Session 2: Upper Abdominal Roadmap",           "section", 2),
    ("qbank-02-anatomy.xml",     "section-02",         "Session 2a: Liver Anatomy",                    "section", 3),
    ("qbank-02b-technique.xml",  "section-02b",        "Session 2b: Scanning Technique",               "section", 4),
    ("qbank-03-diffuse.xml",     "section-03",         "Session 3: Diffuse Liver Pathology",           "section", 5),
    ("qbank-04-focal.xml",       "section-04",         "Session 4: Focal Lesions and HCC Findings",    "section", 6),
    ("qbank-04a-neighbours.xml", "section-04a",        "Session 4a: Beyond the Liver",                 "section", 7),
    ("qbank-05-protocol.xml",    "section-05",         "Session 5: Screening Protocol and Context",    "section", 8),
    ("qbank-06-reporting.xml",   "section-06",         "Session 6: Structured Reporting",              "section", 9),
    ("qbank-posttest.xml",       "posttest",           "Posttest: End of Course",                      "exam",    10),
]


def clean_html(html_text):
    """Moodle question text/feedback is minimal HTML (<p>, <strong>, <em>).
    We keep it as-is since the quiz UI renders it as HTML, but normalise
    whitespace from the CDATA blocks."""
    return re.sub(r"\s+", " ", (html_text or "")).strip()


def parse_bank(path):
    """Returns a list of dicts: stem, choices[4], correct(0-3), rationale."""
    tree = ET.parse(path)
    out = []
    for q in tree.getroot().findall("question"):
        if q.get("type") != "multichoice":
            continue
        name_el = q.find("name/text")
        xml_id = (name_el.text or "").strip() if name_el is not None else ""
        stem_html = q.find("questiontext/text").text or ""
        rationale_html = q.find("generalfeedback/text").text or ""
        answers = q.findall("answer")
        if len(answers) != 4:
            raise ValueError(f"{path}: question does not have exactly 4 answers")
        choices = [clean_html(a.find("text").text) for a in answers]
        correct = [i for i, a in enumerate(answers) if a.get("fraction") == "100"]
        if len(correct) != 1:
            raise ValueError(f"{path}: question does not have exactly 1 correct answer")
        out.append({
            "stem": clean_html(stem_html),
            "choices": choices,
            "correct": correct[0],
            "rationale": clean_html(rationale_html),
            "xml_id": xml_id,
        })
    return out


def ensure_columns(conn):
    """Add the versioning columns to databases created before they existed."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(questions)")}
    if "xml_id" not in cols:
        conn.execute("ALTER TABLE questions ADD COLUMN xml_id TEXT")
    if "retired" not in cols:
        conn.execute("ALTER TABLE questions ADD COLUMN retired INTEGER NOT NULL DEFAULT 0")


def referenced_ids(conn, quiz_id):
    """Question IDs that any attempt at this quiz has shown or answered."""
    ids = {r[0] for r in conn.execute(
        "SELECT DISTINCT aa.question_id FROM attempt_answers aa "
        "JOIN attempts a ON a.id = aa.attempt_id WHERE a.quiz_id=?", (quiz_id,))}
    for (order_json,) in conn.execute("SELECT order_json FROM attempts WHERE quiz_id=?", (quiz_id,)):
        try:
            ids.update(json.loads(order_json))
        except (TypeError, ValueError):
            pass
    return ids


def import_quiz(conn, quiz_id, items):
    """Version-aware import of one quiz's questions. Never deletes or edits a
    question that learners have seen."""
    stats = {"new": 0, "updated": 0, "versioned": 0, "unchanged": 0, "retired": 0, "deleted": 0}
    used = referenced_ids(conn, quiz_id)
    active = conn.execute(
        "SELECT * FROM questions WHERE quiz_id=? AND retired=0 ORDER BY sort_order", (quiz_id,)
    ).fetchall()
    cols = [d[1] for d in conn.execute("PRAGMA table_info(questions)")]
    rows = [dict(zip(cols, r)) for r in active]

    # Legacy rows imported before xml_id existed: match by exact stem first,
    # then by position (earlier imports inserted questions in XML order).
    legacy = [r for r in rows if not r["xml_id"]]
    if legacy:
        unclaimed = list(legacy)
        for item in items:
            hit = next((r for r in unclaimed if r["stem"] == item["stem"]), None)
            if hit:
                hit["xml_id"] = item["xml_id"]; unclaimed.remove(hit)
        for i, item in enumerate(items):
            if any(r["xml_id"] == item["xml_id"] for r in rows):
                continue
            hit = next((r for r in unclaimed if r["sort_order"] == i), None)
            if hit:
                hit["xml_id"] = item["xml_id"]; unclaimed.remove(hit)
        for r in legacy:
            if r["xml_id"]:
                conn.execute("UPDATE questions SET xml_id=? WHERE id=?", (r["xml_id"], r["id"]))

    by_xml = {r["xml_id"]: r for r in rows if r["xml_id"]}
    seen = set()
    for i, item in enumerate(items):
        vals = (item["stem"], *item["choices"], item["correct"], item["rationale"])
        row = by_xml.get(item["xml_id"])
        if row is None:
            conn.execute(
                "INSERT INTO questions (quiz_id, stem, choice_a, choice_b, choice_c, choice_d, correct, rationale, sort_order, xml_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)", (quiz_id, *vals, i, item["xml_id"]))
            stats["new"] += 1
            continue
        seen.add(row["id"])
        old = (row["stem"], row["choice_a"], row["choice_b"], row["choice_c"], row["choice_d"], row["correct"], row["rationale"])
        if old == vals:
            conn.execute("UPDATE questions SET sort_order=? WHERE id=?", (i, row["id"]))
            stats["unchanged"] += 1
        elif row["id"] in used:
            conn.execute("UPDATE questions SET retired=1 WHERE id=?", (row["id"],))
            conn.execute(
                "INSERT INTO questions (quiz_id, stem, choice_a, choice_b, choice_c, choice_d, correct, rationale, sort_order, xml_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)", (quiz_id, *vals, i, item["xml_id"]))
            stats["versioned"] += 1
        else:
            conn.execute(
                "UPDATE questions SET stem=?, choice_a=?, choice_b=?, choice_c=?, choice_d=?, correct=?, rationale=?, sort_order=? WHERE id=?",
                (*vals, i, row["id"]))
            stats["updated"] += 1

    for r in rows:
        if r["id"] in seen:
            continue
        if r["id"] in used:
            conn.execute("UPDATE questions SET retired=1 WHERE id=?", (r["id"],))
            stats["retired"] += 1
        else:
            conn.execute("DELETE FROM questions WHERE id=?", (r["id"],))
            stats["deleted"] += 1
    return stats


def main():
    if not os.path.isdir(SOURCE_DIR):
        raise SystemExit(
            f"Source question banks not found at {SOURCE_DIR}\n"
            f"Copy the qbank-*.xml files there, or set QBANK_SOURCE_DIR."
        )

    fresh = not os.path.exists(DB_PATH)
    if not fresh:
        backup = f"{DB_PATH}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(DB_PATH, backup)
        print(f"Backed up existing database to {backup}")
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(open(SCHEMA_PATH, encoding="utf-8").read())
    ensure_columns(conn)

    total = 0
    for fname, quiz_id, title, mode, order in QUIZZES:
        path = os.path.join(SOURCE_DIR, fname)
        if not os.path.exists(path):
            print(f"  SKIP (not found): {fname}")
            continue
        items = parse_bank(path)
        conn.execute(
            "INSERT INTO quizzes (id, title, mode, sort_order) VALUES (?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET title=excluded.title, mode=excluded.mode, sort_order=excluded.sort_order",
            (quiz_id, title, mode, order),
        )
        stats = import_quiz(conn, quiz_id, items)
        total += len(items)
        print(f"  {quiz_id:14s} {len(items):3d} items  <- {fname}   " +
              ", ".join(f"{k} {v}" for k, v in stats.items() if v))

    conn.commit()
    print(f"\nImported {total} questions across {len(QUIZZES)} quizzes into {DB_PATH}")

    if fresh:
        print("\nFresh database, create the first admin/instructor account now.")
        name = input("  Admin name: ").strip()
        email = input("  Admin email: ").strip().lower()
        pw = getpass.getpass("  Admin password: ")
        conn.execute(
            "INSERT INTO users (name, email, password_hash, role) VALUES (?,?,?,'admin')",
            (name, email, generate_password_hash(pw)),
        )
        conn.commit()
        print(f"  Created admin account for {email}")

    conn.close()


if __name__ == "__main__":
    main()
