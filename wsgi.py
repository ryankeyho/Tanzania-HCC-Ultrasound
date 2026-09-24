"""
Entry point for gunicorn. The dev server (`python3 server.py`) is fine for
local testing but explicitly refuses to be a production server, this
file is what systemd actually runs.

    gunicorn --workers 2 --bind 127.0.0.1:8000 wsgi:app

Two workers is enough for a cohort of 8-15 concurrent trainees; SQLite
does not benefit from more than a handful of worker processes anyway
since writes serialize against the one database file.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "app"))

from server import app  # noqa: E402

if __name__ == "__main__":
    app.run()
