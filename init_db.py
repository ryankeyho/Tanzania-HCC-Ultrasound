"""
Builds app/liverpocus.db from schema.sql and populates it with the same
337 questions already verified in the Moodle XML banks (qbank-*.xml).

Run once at deploy time, and again any time the source XML changes:
    python3 init_db.py
"""
import sqlite3
import re
import os
import glob
import getpass
from werkzeug.security import generate_password_hash
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "app", "liverpocus.db")
SCHEMA_PATH = os.path.join(HERE, "app", "schema.sql")
SOURCE_DIR = os.environ.get("QBANK_SOURCE_DIR", os.path.join(HERE, "source_qbanks"))

# (xml filename, quiz id slug, display title, mode, sort order)
QUIZZES = [
    ("qbank-pretest.xml",        "pretest",           "Pretest: Baseline Knowledge",                 "exam",    0),
    ("qbank-01-physics.xml",     "section-01",         "Section 1: Physics and Equipment",             "section", 1),
    ("qbank-02a-roadmap.xml",    "section-02a",        "Section 2: Upper Abdominal Roadmap",           "section", 2),
    ("qbank-02-anatomy.xml",     "section-02",         "Section 2a: Liver Anatomy",                    "section", 3),
    ("qbank-02b-technique.xml",  "section-02b",        "Section 2b: Scanning Technique",               "section", 4),
    ("qbank-03-diffuse.xml",     "section-03",         "Section 3: Diffuse Liver Pathology",           "section", 5),
    ("qbank-04-focal.xml",       "section-04",         "Section 4: Focal Lesions and HCC Findings",    "section", 6),
    ("qbank-04a-neighbours.xml", "section-04a",        "Section 4a: Beyond the Liver",                 "section", 7),
    ("qbank-05-protocol.xml",    "section-05",         "Section 5: Screening Protocol and Context",    "section", 8),
    ("qbank-06-reporting.xml",   "section-06",         "Section 6: Structured Reporting",              "section", 9),
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
        })
    return out


def main():
    if not os.path.isdir(SOURCE_DIR):
        raise SystemExit(
            f"Source question banks not found at {SOURCE_DIR}\n"
            f"Copy the qbank-*.xml files there, or set QBANK_SOURCE_DIR."
        )

    fresh = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(open(SCHEMA_PATH, encoding="utf-8").read())

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
        # replace existing questions for this quiz cleanly on re-import
        conn.execute("DELETE FROM questions WHERE quiz_id = ?", (quiz_id,))
        for i, item in enumerate(items):
            conn.execute(
                "INSERT INTO questions (quiz_id, stem, choice_a, choice_b, choice_c, choice_d, correct, rationale, sort_order) "
                "VALUES (?,?,?,?,?,?,?,?,?)",
                (quiz_id, item["stem"], *item["choices"], item["correct"], item["rationale"], i),
            )
        total += len(items)
        print(f"  {quiz_id:14s} {len(items):3d} items  <- {fname}")

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
