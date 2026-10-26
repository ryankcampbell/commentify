#!/bin/bash
# Run locally (seeds from ./comments.json on first open). The deployed app is on GitHub Pages.
cd "$(dirname "$0")"
(sleep 0.5; open "http://localhost:5050") &
python3 -m http.server 5050
