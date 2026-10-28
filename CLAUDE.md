# Commentify

A keyboard-first, installable web app (PWA) holding a bank of report card comments, split into **+ going well** and **− to improve**. Ryan searches, picks a few, tweaks the wording, copies (⌘↵) and pastes into the school's grade portal. Nothing is stored per student: the checkout is scratch space that "New student" (Esc) wipes.

Live at https://ryankcampbell.github.io/commentify/ (GitHub Pages, served from `main`).

## Stack

Plain static files, no build step, no dependencies.

| File | What it is |
|---|---|
| `index.html` | Markup, settings dialog, hotkeys dialog |
| `app.js` | Everything: search, render, checkout, copy (plain + rich HTML), GitHub sync |
| `style.css` | Styles |
| `sw.js` | Service worker: network-first app shell, offline fallback. Never caches `comments.json` |
| `manifest.webmanifest`, `icons/` | PWA install |
| `.nojekyll` | Keeps Pages from running Jekyll |

Run locally:

```bash
./start.sh
```

That serves the folder on http://localhost:5050. On first open with an empty bank, the app seeds itself from the local `comments.json`.

## Where data lives

- **The bank** lives in the browser's `localStorage` (`cfy.bank`), one array of `{id, kind: '+'|'-', tag, text, uses, t, del?}`. Merging is per comment, newest `t` wins, and deletes are kept as tombstones.
- **Sync:** ⚙ → GitHub sync mirrors the bank to `comments.json` in the **private** `commentify-data` repo through the GitHub Contents API. It pulls on open and on refocus, and pushes about 1.5 s after a change. The fine-grained token is stored only in that browser's `localStorage` (`cfy.cfg`).
- **Local `comments.json`** in this folder is a dev seed copy of the bank. It is gitignored. Don't read it beyond its shape.
- **Old versions** `v1_backup/` and `commentify_oldtkinterversion/` are local only and gitignored. Their gradebooks (`v1_backup/grades/`, `gradebook2025/`, `*.db`) are blocked by deny rules. Don't open these folders and don't work around a denial. Ryan has agreed to retire both to `NWA/V. Old/` (see STATE.md).

## Public repo safety

This repo (`ryankcampbell/commentify`) is **public**. Anything committed here is on the internet.

- `comments.json`, `*.db`, `v1_backup/` and `commentify_oldtkinterversion/` are gitignored. Keep it that way. Never `git add -f` any of them.
- The comment bank belongs only in the private `commentify-data` repo, reached through the app's sync setting. Never copy bank data into this repo, including as a test fixture, example or starter file.
- **Before any commit,** run `git status` and confirm no data file is staged. Stage files by name, never `git add -A` or `git add .`.
- **Never commit a token.** No `github_pat_…` strings, no `.env`, no tokens in code, comments, docs or commit messages.
- **Never write a student's name** into code, comments, commit messages or these docs.
- **Pushing needs Ryan's yes.** A push to `main` deploys to the live site.

## Working here

- Keep it one plain JS file with no framework and no build. Match the existing terse style and comment density in `app.js`.
- Because the service worker is network-first, an edit is live on next open. No cache version bumping is needed unless the shell file list changes.
- After finishing a task, update `STATE.md` and append a dated line to `LOG.md` so the hub can pick it up.
