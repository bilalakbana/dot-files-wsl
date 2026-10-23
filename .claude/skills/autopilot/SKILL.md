---
name: autopilot
description: Turn a task into a brief the user approves once, then run it to completion while the user is away. Use only when the user invokes /autopilot.
disable-model-invocation: true
---

# Autopilot

Autopilot has two phases. Phase A needs the user. Phase B runs without the user.

## Phase A: brief (user present)

1. Read the task in the arguments. If the idea is vague (who, why, success or constraint is missing), load the `interview-me` skill first. Use its confirmed intent as input for the brief.
2. Fill this brief. For each field, propose a default from what you know, so the user can answer "ok". Ask only about fields you cannot fill, one question at a time, each with your guess.

   ```
   TASK:     what to build or do, 1–2 sentences
   WHY:      the purpose; it guides every decision in Phase B
   FOLDER:   the working folder
   DONE:     checks you can run yourself (a command, a test, a screenshot)
   AUTONOMY: plan without waiting; decide and log; subagents up to N; budget ~$X; local git yes/no
   LIMITS:   what not to touch
   REPORT:   REPORT.md in FOLDER
   ```

   - DONE must be checkable by you, with no human in the loop. If the user gives a vague criterion ("it works well"), propose a testable one.
   - AUTONOMY default: up to 3 subagents, budget ~$5. Local git: yes if FOLDER is new or empty, no if FOLDER already has files or a repo.
3. Do the pre-flight checks. Show each check as one table row with its result:
   - The permission mode is `auto`. Look for the auto mode notice in your context. If it is absent, tell the user to press Shift+Tab, or to restart with `claude --permission-mode auto`.
   - FOLDER exists, or you can create it.
   - The tools that DONE needs are installed (for example docker, node, a Python `.venv`).
   - Steps that hit a hard rule in CLAUDE.md or an `ask` rule in the user's permission settings (git commit or push, deleting, secrets, email, purchases, sudo). List them now. For each, get the user's decision now, or mark it "skip and report".
4. Show these four parts, in this order, in the user's language:
   - **Anladığım:** what the user wants, the purpose, how success looks, and what is out of scope. One line each.
   - **İş akışı:** the numbered steps in order, each with its check. Name the skills and subagents (with model) you plan to use, and estimate the time and cost.
   - **Brief:** the filled brief.
   - **Ön kontrol:** the pre-flight table.
   Then ask: "Onaylıyor musun?" Only an explicit "evet" starts Phase B.

## Phase B: run (user away)

The user's "evet" approves the AUTONOMY section, as the Autopilot rule in CLAUDE.md says. The hard rules still apply.

1. Write the approved brief to `BRIEF.md` in FOLDER. If AUTONOMY says local git yes, run `git init` in FOLDER and add `.tmp/` and `.venv/` to `.gitignore`.
2. If the work is large (several components, or more than about 2 hours), load `spec-driven-development` and write `SPEC.md`. The brief approval replaces the spec approval stop of that skill: continue in the same turn.
3. Write `PLAN.md` from the approved İş akışı: a table of tasks in dependency order, each task with one check and a Status column. If you must change the approved flow, write the change and its reason in `DECISIONS.md`.
   - If `PLAN.md` already exists (a resumed run), continue from the first task that is not done.
4. Do the tasks in dependency order. Run independent tasks in parallel. After each task, run its check, then set its Status in `PLAN.md`. With local git, stage the task's files with `git add` after its check passes; the user commits.
   - A check fails: find the root cause and fix it.
   - The same fix fails twice: try a different approach, or mark the task "blocked" and continue with the tasks that do not depend on it.
5. Use subagents for parts that are independent and can run in parallel. Stay within the cap. Choose the model per subagent by difficulty: haiku for mechanical work, sonnet for scoped implementation, the main session's model for hard reasoning and the final review. Give each subagent a complete prompt: its goal, its files, its check and its limits. It cannot see this conversation.
6. Do not ask the user anything in Phase B. Make the decision, then write it and its reason in `DECISIONS.md`. If a decision cannot be undone or hits a hard rule, do not do it: list it for the report.
7. Do the final verification. Run every DONE check again from a clean state (for example a fresh `docker compose up`). Record each command and a short excerpt of its output. Then stop every server and background process you started.
8. Write `REPORT.md`:
   - Result: done, partial or blocked.
   - Each DONE check with its evidence.
   - What you skipped, and why.
   - What the user must do next, with ready commands: the `git commit` (with local git) and the `rm` for temporary data in `FOLDER/.tmp/` that the report does not need.
   - Subagents used, and the cost if you know it. If you do not know the cost, say so.
9. If a push notification tool is available, send one line: the result and the path to REPORT.md. Then stop.

## Rules for both phases

- Work only inside FOLDER, unless the brief names another place.
- Put all temporary and test output in `FOLDER/.tmp/`, so nothing is left outside FOLDER.
- Never run a command that matches an `ask` rule in the user's permission settings (for example `git commit`, `git push`, `rm`). In Phase B nobody can answer the prompt, so the run would stop until the user returns. Write the command in REPORT.md instead.
- Keep the files short: the user reads REPORT.md first and the other files only when needed.
- When the budget or the subagent cap is reached, start no new work. Write the report.
