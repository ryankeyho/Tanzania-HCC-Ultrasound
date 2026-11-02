-- Liver POCUS course — application database schema
-- SQLite. Designed for a small cohort (tens to low hundreds of users),
-- not for high-concurrency multi-tenant use.

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'trainee' CHECK (role IN ('trainee','instructor','admin')),
    cohort        TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per quiz (maps 1:1 to the Moodle question-bank categories already built).
CREATE TABLE IF NOT EXISTS quizzes (
    id          TEXT PRIMARY KEY,       -- slug, e.g. 'pretest', 'section-01-physics'
    title       TEXT NOT NULL,
    mode        TEXT NOT NULL CHECK (mode IN ('section','exam')),
    -- section: immediate per-question feedback, unlimited retakes, formative
    -- exam: answers withheld until submission, intended as a single attempt
    sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    quiz_id     TEXT NOT NULL REFERENCES quizzes(id),
    stem        TEXT NOT NULL,
    choice_a    TEXT NOT NULL,
    choice_b    TEXT NOT NULL,
    choice_c    TEXT NOT NULL,
    choice_d    TEXT NOT NULL,
    correct     INTEGER NOT NULL CHECK (correct IN (0,1,2,3)),
    rationale   TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    xml_id      TEXT,                    -- stable ID from the source XML (e.g. 'Q014')
    retired     INTEGER NOT NULL DEFAULT 0 -- 1 = superseded version kept for learner history
);

-- One row per completed (or in-progress) attempt at a quiz.
CREATE TABLE IF NOT EXISTS attempts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id),
    quiz_id      TEXT NOT NULL REFERENCES quizzes(id),
    started_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    score        INTEGER,             -- number correct, set on completion
    total        INTEGER,             -- number of items, set on completion
    order_json   TEXT NOT NULL        -- JSON list of question ids, in the shuffled
                                       -- order shown to this user for this attempt
);

-- One row per answered question within an attempt. This is what lets an
-- instructor see *which* topics a cohort is weak on, not just raw scores.
CREATE TABLE IF NOT EXISTS attempt_answers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id    INTEGER NOT NULL REFERENCES attempts(id),
    question_id   INTEGER NOT NULL REFERENCES questions(id),
    selected      INTEGER NOT NULL CHECK (selected IN (0,1,2,3)),
    is_correct    INTEGER NOT NULL CHECK (is_correct IN (0,1)),
    answered_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_quiz ON questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON attempts(quiz_id);
CREATE INDEX IF NOT EXISTS idx_answers_attempt ON attempt_answers(attempt_id);

-- Reviewer comments: highlighted passages (or figures) with a category and a note.
-- Reviewers see only their own; instructors and admins see all.
CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    page        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','figure')),
    quote       TEXT NOT NULL,
    prefix      TEXT NOT NULL DEFAULT '',
    suffix      TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'other',
    comment     TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','declined')),
    admin_note  TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(page);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
