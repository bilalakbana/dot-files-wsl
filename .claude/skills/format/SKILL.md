---
name: format
description: "Use when code changes are complete and ready to be cleaned up. Formats modified files using the appropriate formatter for each language. Never use mid-edit — only after all edits are done."
disable-model-invocation: false
allowed-tools: Bash, Glob, Read
---

# Format Modified Files

Format all modified files (staged + unstaged) using the correct formatter for each language.

## Process

1. Get modified files: `git diff --name-only` + `git diff --cached --name-only`
2. If not a git repo, ask the user which files to format.
3. For each file, detect language by extension and run the appropriate formatter:

| Extension | Formatter | Fallback |
|-----------|-----------|----------|
| `.py` | `ruff format <file>` | `black <file>` |
| `.c`, `.h` | `clang-format -i <file>` (only if `.clang-format` exists in project) | Skip with warning |
| `.kt` | `ktlint --format <file>` | Skip with warning |
| `.swift` | `swiftformat <file>` | Skip with warning |
| `.js`, `.ts`, `.json` | `prettier --write <file>` | Skip with warning |
| Other | Skip | Warn: "No formatter for .ext" |

4. If a formatter is not installed, WARN — do not silently skip (fail loudly principle).
5. Report results: "Formatted N files: a.py, b.c. Skipped M files: e.m (no MATLAB formatter)"

## Rules

- NEVER run mid-edit. Only when all code changes are complete.
- NEVER format files that are not modified (git-tracked changes only).
- If no files are modified, say so and exit.
- Respect project-specific formatter configs (.clang-format, ruff.toml, .prettierrc).
- Check formatter exists before running: `command -v ruff`, `command -v clang-format`, etc.
