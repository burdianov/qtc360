---
description: Minimal-token frontend task
---

Use minimal context.

Task:
$ARGUMENTS

Read first:

- CLAUDE.md
- docs/claude-map.md

Rules:

- Work only in frontend unless backend change is explicitly required.
- Identify target page/component before opening files.
- Do not read package-lock.json or .next.
- Do not open large QAQC form pages fully; use grep and line ranges.
- Validate with npx tsc --noEmit.
- Final answer: files changed, commands run, risks.
