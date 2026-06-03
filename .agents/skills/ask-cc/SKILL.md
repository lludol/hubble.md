---
name: ask-cc
description: Ask Claude Code to make a taste-driven call on something ambiguous — UI polish, prose phrasing, naming, formatting. Use when you'd otherwise guess.
argument-hint: "The question + any file paths to consider"
---

You hit something fuzzy and need a judgment call. Shell out to the `claude` CLI to get one back, then apply it.

Run from the repo root so `claude` can read files by relative path:

```bash
claude -p --model claude-opus-4-7 "$(cat <<'EOF'
<your question, stated plainly>

Files to consider: <paths, if any>

Weigh a few options, give your recommendation, and share others as alternatives considered.
Length is up to you — a design call may warrant several paragraphs;
a naming call may not. Match the depth to the decision.
EOF
)"
```
