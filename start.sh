#!/bin/sh
# Starts Lumacut with the local AI server (macOS / Linux).
# First run creates .venv and installs PyTorch; the AI models (~830 MB)
# download on first start.
set -e
cd "$(dirname "$0")"

if [ ! -x .venv/bin/python ]; then
  PY=""
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys; sys.exit(0 if (3, 10) <= sys.version_info[:2] <= (3, 13) else 1)' 2>/dev/null; then
      PY="$candidate"
      break
    fi
  done
  if [ -z "$PY" ]; then
    echo "Lumacut needs Python 3.10 to 3.13: https://www.python.org/downloads/"
    exit 1
  fi

  echo "Creating Python environment with $PY…"
  if ! "$PY" -m venv .venv; then
    echo "Could not create a virtual environment."
    echo "On Debian/Ubuntu, install it with: sudo apt install python3-venv"
    exit 1
  fi
  .venv/bin/pip install --quiet --upgrade pip
  echo "Installing PyTorch and friends (this can take a few minutes)…"
  if ! .venv/bin/pip install --quiet -r requirements.txt; then
    rm -rf .venv
    echo "Install failed. Fix the error above, then run ./start.sh again."
    exit 1
  fi
fi

exec .venv/bin/python server.py
