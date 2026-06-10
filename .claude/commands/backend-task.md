---
description: Minimal-token backend task
---

Use minimal context.

Task:
$ARGUMENTS

Read first:

- CLAUDE.md
- docs/claude-map.md

Rules:

- Identify at most 3 files needed before reading more.
- Prefer grep over opening large files.
- Do not read migrations, uv.lock, fonts, db_dump, .env, or seed files.
- Make the smallest safe backend change.
- Validate with compileall first.
- Run pytest only with a targeted -k filter.
- Final answer: files changed, commands run, risks.
