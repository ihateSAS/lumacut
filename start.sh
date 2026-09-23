#!/bin/sh
# Starts Lumacut with the local AI server. First run creates .venv and installs
# PyTorch + models (~1.3 GB of model weights download on first start).
set -e
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "Creating Python environment…"
  python3 -m venv .venv
  .venv/bin/pip install --quiet --upgrade pip
  .venv/bin/pip install --quiet -r requirements.txt
fi
exec .venv/bin/python server.py
