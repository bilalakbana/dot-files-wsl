#!/usr/bin/env python3
"""Write the chat of the Claude Code session running in a tmux pane as coloured text.

Claude's fullscreen view keeps the conversation out of tmux's history; its transcript file has it.
~/.claude/sessions/<pid>.json names each live session's tmux pane ("tmux": "1:@0.%0") and its id;
the transcript is ~/.claude/projects/*/<id>.jsonl. Your messages and Claude's answers are written in
full, with their Markdown drawn (bold, code, headings, lists, tables) in Catppuccin Macchiato
colours; each tool call is one dim line; tool output and thinking are left out.

Usage: claude-chat-text.py <pane-id> <out-dir>   prints the path of the written file
       claude-chat-text.py --transcript <file.jsonl>  prints one transcript's chat to stdout
Exits 1 with the reason on stderr when the pane has no live Claude session or no transcript.
"""
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

CLAUDE = Path.home() / ".claude"


def rgb(hex_colour: str) -> str:
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return f"\x1b[38;2;{r};{g};{b}m"


# Catppuccin Macchiato
TEXT, SUBTEXT, OVERLAY, SURFACE = rgb("#cad3f5"), rgb("#a5adcb"), rgb("#6e738d"), rgb("#494d64")
BLUE, MAUVE, LAVENDER = rgb("#8aadf4"), rgb("#c6a0f6"), rgb("#b7bdf8")
PEACH, GREEN, TEAL, YELLOW = rgb("#f5a97f"), rgb("#a6da95"), rgb("#8bd5ca"), rgb("#eed49f")
BOLD, NO_BOLD, UNDERLINE, NO_UNDERLINE, RESET = "\x1b[1m", "\x1b[22m", "\x1b[4m", "\x1b[24m", "\x1b[0m"

SPEAKER = {"You": BLUE, "Claude": MAUVE}


def fail(reason: str) -> None:
    print(reason, file=sys.stderr)
    sys.exit(1)


def is_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def session_for_pane(pane: str) -> dict:
    found = []
    for path in (CLAUDE / "sessions").glob("*.json"):
        try:
            info = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError) as err:
            print(f"skipping {path}: {err}", file=sys.stderr)
            continue
        if str(info.get("tmux", "")).endswith("." + pane) and is_alive(int(info.get("pid", 0))):
            found.append(info)
    if not found:
        fail(f"no live Claude session is registered for tmux pane {pane}")
    return max(found, key=lambda info: info.get("updatedAt", 0))


def local_time(stamp: str) -> str:
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone().strftime("%d.%m %H:%M")
    except ValueError:
        return ""


# ── Markdown → ANSI ───────────────────────────────────────────────────────────

def inline(text: str, base: str) -> str:
    """Bold, `code` and [links](url) inside one line; `base` is the line's own colour."""
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for part in parts:
        if len(part) > 1 and part.startswith("`") and part.endswith("`"):
            out.append(f"{PEACH}{part[1:-1]}{base}")
            continue
        part = re.sub(r"\*\*(.+?)\*\*", lambda m: f"{BOLD}{m.group(1)}{NO_BOLD}", part)
        part = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)",
                      lambda m: f"{BLUE}{UNDERLINE}{m.group(1)}{NO_UNDERLINE}{OVERLAY} ({m.group(2)}){base}", part)
        out.append(part)
    return "".join(out)


def render(text: str, gutter: str):
    """Markdown block → coloured lines, each led by the speaker's gutter."""
    in_code = False
    for line in text.rstrip().splitlines():
        stripped = line.strip()
        if stripped == "" and not in_code:
            yield ""  # blank: no gutter, so the search list can leave it out
            continue
        if stripped.startswith("```"):
            in_code = not in_code
            yield f"{gutter}{OVERLAY}{line}{RESET}"
            continue
        if in_code:
            yield f"{gutter}{GREEN}{line}{RESET}"
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            yield f"{gutter}{LAVENDER}{BOLD}{inline(heading.group(2), LAVENDER + BOLD)}{RESET}"
        elif re.fullmatch(r"[-━─=_*]{3,}", stripped):
            yield f"{gutter}{SURFACE}{line}{RESET}"
        elif stripped.startswith("|"):
            if re.fullmatch(r"\|[\s:|-]+\|?", stripped):
                yield f"{gutter}{SURFACE}{line}{RESET}"
            else:
                cells = line.replace("|", f"{SURFACE}|{TEXT}")
                yield f"{gutter}{TEXT}{inline(cells, TEXT)}{RESET}"
        else:
            bullet = re.match(r"^(\s*)[-*]\s+(.*)$", line)
            if bullet:
                body = f"{bullet.group(1)}{OVERLAY}•{TEXT} {bullet.group(2)}"
            else:
                body = line
            yield f"{gutter}{TEXT}{inline(body, TEXT)}{RESET}"


def tool_line(block: dict, gutter: str) -> str:
    args = block.get("input") or {}
    detail = next(
        (str(args[key]) for key in ("description", "command", "file_path", "skill", "pattern", "url", "query", "prompt")
         if args.get(key)),
        "",
    )
    detail = detail.splitlines()[0][:200] if detail else ""
    return f"{gutter}{OVERLAY}⏺ {TEAL}{block.get('name', 'tool')}{OVERLAY} · {detail}{RESET}"


# ── Transcript ────────────────────────────────────────────────────────────────

def chat_lines(transcript: Path):
    speaker = None
    with transcript.open() as lines:
        for raw in lines:
            try:
                entry = json.loads(raw)
            except json.JSONDecodeError:
                continue  # a line still being written
            if entry.get("isSidechain") or entry.get("isMeta"):
                continue
            kind = entry.get("type")
            texts, tools = [], []
            if kind == "user":
                content = entry.get("message", {}).get("content")
                if isinstance(content, str):
                    texts.append(content)
                else:
                    texts += [b.get("text", "") for b in content or [] if b.get("type") == "text"]
                who = "You"
            elif kind == "attachment" and (entry.get("attachment") or {}).get("type") == "queued_command":
                prompt = entry["attachment"].get("prompt", "")  # a list of blocks when it carried an image
                texts += [prompt] if isinstance(prompt, str) else [
                    b.get("text", "") for b in prompt if isinstance(b, dict) and b.get("type") == "text"]
                who = "You"
            elif kind == "assistant":
                tools = [b for b in entry.get("message", {}).get("content") or [] if b.get("type") == "tool_use"]
                texts = [b.get("text", "") for b in entry.get("message", {}).get("content") or []
                         if b.get("type") == "text"]
                who = "Claude"
            else:
                continue
            # leave out what you did not type: notifications, agent messages, command records
            texts = [text for text in texts if text.strip() and not text.lstrip().startswith("<")]
            if not texts and not tools:
                continue
            colour = SPEAKER[who]
            gutter = f"{colour}▍ "
            if who != speaker:
                yield ""
                yield f"{colour}{BOLD}{who}{NO_BOLD}{OVERLAY} · {local_time(entry.get('timestamp', ''))}{RESET}"
                speaker = who
            for text in texts:
                yield from render(text, gutter)
            for block in tools:
                yield tool_line(block, gutter)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == "--transcript":
        print("\n".join(chat_lines(Path(sys.argv[2]))).lstrip("\n"))
        return
    if len(sys.argv) != 3:
        fail("usage: claude-chat-text.py <pane-id> <out-dir>")
    pane, out_dir = sys.argv[1], Path(sys.argv[2])
    info = session_for_pane(pane)
    session_id = info.get("sessionId", "")
    transcripts = list((CLAUDE / "projects").glob(f"*/{session_id}.jsonl"))
    if not transcripts:
        fail(f"no transcript for session {session_id}")
    name = str(info.get("name") or session_id).replace("/", "-")
    out = out_dir / f"claude-{name}.txt"
    out.write_text("\n".join(chat_lines(transcripts[0])).lstrip("\n") + "\n")
    print(out)


if __name__ == "__main__":
    main()
