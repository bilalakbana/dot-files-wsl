# dot-files-wsl

Terminal setup for **Ubuntu 26.04 LTS on WSL**: Ghostty (inside WSL, shown on Windows through WSLg),
zsh + zsh4humans + powerlevel10k, tmux, Neovim + LazyVim, and the search tools behind
[search-functions](https://github.com/bilalakbana/search-functions) (ugrep built from source with every
archive format, ripgrep, ripgrep-all, fzf, fd, bat, delta, ...), with Intel One Mono as the terminal font,
plus Claude Code's look and extras: fullscreen UI, the Catppuccin theme, the *workspace* side pane (a mod),
the global `CLAUDE.md` (Bilal's rules for Claude), and the plugins and skills that the Linux PC uses.

The steps below are written so that **Claude Code running inside WSL** can carry them out. A person can
follow them just as well.

---

## For Claude Code: how to work through this

- Do the steps in order and run each step's **Check** before going on. If a check fails, stop and report
  the command, its output and what you think is wrong. Do not work around a failure silently.
- **Never delete anything.** When a file or folder that would be replaced already exists, rename it to
  `<name>.bak-<date>-<time>` (the commands below do this) and tell the user.
- **sudo needs the user's password, which you cannot type.** Every `sudo` command is grouped in a block
  marked **(user runs)**: ask the user to run that block themselves by typing it after `!` in the Claude
  Code prompt (`! sudo apt install ...`), then continue with the check.
- If `apt` says *Unable to locate package X*, run the install again without X, and list X in your
  final report. Do not substitute another package on your own.
- Versions below were current on 2026-10-16. Where a step says *latest release*, look the version up
  (`curl -s https://api.github.com/repos/OWNER/REPO/releases/latest | grep tag_name`) and use it.
- At the end, give the user a short report: what is installed (with versions), what was skipped, what
  was backed up, and anything they still have to do by hand.

---

## 1. Packages from Ubuntu  (user runs)

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config git curl wget ca-certificates unzip zip 7zip xz-utils fontconfig \
  zsh tmux neovim tree-sitter-cli lazygit gh jq tree lsd fd-find bat git-delta nodejs npm python3 \
  libpcre2-dev zlib1g-dev libbz2-dev liblzma-dev liblz4-dev libzstd-dev libbrotli-dev \
  poppler-utils antiword pandoc libimage-exiftool-perl ffmpeg pipx
```

What they are for: `build-essential`, `pkg-config` and the `lib*-dev` packages build ugrep (PCRE2 regex,
zlib/bzip2/xz/lz4/zstd/brotli for `-z`; 7-Zip support is bundled in ugrep). `poppler-utils` (pdftotext),
`antiword`, `pandoc` and `libimage-exiftool-perl` are the filters of `ugrep+` (PDF, .doc, .docx/.odt/.epub/.rtf,
image metadata); `pandoc`, `poppler-utils` and `ffmpeg` are the adapters of `rga`. `tree-sitter-cli`, the C
compiler and `curl` are required by LazyVim; `lazygit` is optional for it. `git-delta` and `nodejs`/`npm`
(for git-split-diffs) are used by the git functions of search-functions. `pipx` installs graphify for
Claude Code (step 12).

**Check:** `nvim --version | head -1` shows 0.11.2 or newer (Ubuntu 26.04 ships 0.11.6), and
`fdfind --version; batcat --version; delta --version; tree-sitter --version` all print a version.

## 2. `fd` and `bat` under their usual names

Ubuntu installs them as `fdfind` and `batcat`; every config and script here calls `fd` and `bat`.

```bash
mkdir -p ~/.local/bin
[ -e ~/.local/bin/fd ]  || ln -s "$(command -v fdfind)" ~/.local/bin/fd
[ -e ~/.local/bin/bat ] || ln -s "$(command -v batcat)" ~/.local/bin/bat
```

**Check:** `~/.local/bin/fd --version` and `~/.local/bin/bat --version` work.

## 3. fzf, latest release, into `~/.local/bin`

Ubuntu's fzf is too old for search-functions (it needs 0.58 or newer for `--style`), and the zsh config
points z4h at `~/.local/bin/fzf`.

```bash
V=0.74.5   # latest release of junegunn/fzf, without the "v"
cd "$(mktemp -d)"
curl -fsSLO "https://github.com/junegunn/fzf/releases/download/v$V/fzf-$V-linux_amd64.tar.gz"
curl -fsSLO "https://github.com/junegunn/fzf/releases/download/v$V/fzf_${V}_checksums.txt"
grep "fzf-$V-linux_amd64.tar.gz" "fzf_${V}_checksums.txt" | sha256sum -c -
tar -xzf "fzf-$V-linux_amd64.tar.gz" && install -m 755 fzf ~/.local/bin/fzf
```

**Check:** the `sha256sum -c` line printed `OK`, and `~/.local/bin/fzf --version` shows the version.

## 4. ugrep, built from source

Built the same way as on the Linux PC: `./configure --enable-pretty` with every compression library from
step 1. `make install` puts `ugrep`, `ug`, `ugrep+` and `ug+` into `/usr/local/bin`.

```bash
V=v7.8.5   # latest release tag of Genivia/ugrep
mkdir -p ~/GitHub
git clone --depth 1 --branch "$V" https://github.com/Genivia/ugrep.git ~/GitHub/ugrep
cd ~/GitHub/ugrep && ./build.sh --enable-pretty
```

Then **(user runs)**:

```bash
cd ~/GitHub/ugrep && sudo make install
```

**Check:** `ugrep --version` lists `-P:pcre2jit` and `-z:zlib,bzip2,lzma,lz4,zstd,brotli,7z,tar/pax/cpio/zip`
(a missing name means its `lib*-dev` package was missing during `./build.sh`), and `command -v ugrep+ ug+`
prints `/usr/local/bin/...` for both.

## 5. Rust, ripgrep and ripgrep-all

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
. "$HOME/.cargo/env"
cargo install --locked ripgrep
cargo install --locked ripgrep_all
```

**Check:** `rg --version` and `rga --version` work, and `rga --rga-list-adapters` lists `pandoc`, `poppler`
and `ffmpeg` among the adapters.

## 6. git-split-diffs  (user runs)

```bash
sudo npm install -g git-split-diffs
```

**Check:** `command -v git-split-diffs` prints a path.

## 7. Fonts

Ghostty runs inside WSL, so the fonts go into WSL (Windows fonts are not visible to it). Intel One Mono is
the terminal font; the Nerd Font icons of the prompt, lsd and Neovim come from Ghostty's built-in symbol
font. JetBrainsMono Nerd Font is installed as well, for any terminal without built-in icons.

```bash
cd "$(mktemp -d)"
curl -fsSLo intel.zip https://github.com/intel/intel-one-mono/releases/download/V1.4.0/ttf.zip   # latest release of intel/intel-one-mono
curl -fsSLO https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.tar.xz # latest release of ryanoasis/nerd-fonts
mkdir -p ~/.local/share/fonts/IntelOneMono ~/.local/share/fonts/JetBrainsMonoNerd
unzip -j -o intel.zip '*.ttf' -d ~/.local/share/fonts/IntelOneMono
tar -xJf JetBrainsMono.tar.xz -C ~/.local/share/fonts/JetBrainsMonoNerd
fc-cache -f
```

**Check:** `fc-list | grep -c "Intel One Mono"` and `fc-list | grep -c "JetBrainsMono Nerd Font"` are both
greater than 0.

If the user also works in a terminal that runs on Windows itself (Windows Terminal, an unofficial Ghostty
port), that terminal needs the fonts installed in Windows: ask the user to open the `.ttf` files from
`\\wsl.localhost\<distro>\home\<user>\.local\share\fonts\` in Windows (`wslpath -w ~/.local/share/fonts`
prints the exact path) and click *Install*.

The Linux PC also has document fonts (Aref Ruqaa, Scheherazade New, Shaikh Hamdullah Mushaf, Elif1,
Atkinson Hyperlegible, Cinzel, Cormorant Garamond, Playfair Display, Victor Mono). They are not needed for
the terminal; install them only if the user asks.

## 8. The dotfiles

Clone this repo to `~/.dot-files` and link its files into the home folder. An existing file in the way is
renamed to `<name>.bak-<date>-<time>`; an existing link is left alone and reported.

```bash
[ -d ~/.dot-files ] || git clone https://github.com/bilalakbana/dot-files-wsl.git ~/.dot-files
cd ~
for f in .zshenv .zshrc .p10k.zsh .tmux.conf \
         .config/shell/env.sh .config/shell/aliases.sh \
         .config/tmux/history-search .config/tmux/claude-chat-text.py \
         .config/ghostty/config; do
  mkdir -p "$(dirname "$f")"
  if [ -L "$f" ]; then
    [ "$(readlink "$f")" = "$HOME/.dot-files/$f" ] || echo "a different link, left alone: $f -> $(readlink "$f")"
    continue
  fi
  if [ -e "$f" ]; then b="$f.bak-$(date +%F-%H%M%S)"; mv -- "$f" "$b" && echo "backed up: $b"; fi
  ln -s "$HOME/.dot-files/$f" "$f"
done
grep -q 'config/shell/env.sh' ~/.bashrc || printf '\n# Shared with zsh: PATH/exports and aliases\n. ~/.config/shell/env.sh\n. ~/.config/shell/aliases.sh\n' >> ~/.bashrc
```

**Check:** `ls -l ~/.zshrc ~/.tmux.conf ~/.config/ghostty/config` shows links into `~/.dot-files`, and
`bash -ic 'command -v fd bat fzf'` finds all three in `~/.local/bin`.

## 9. search-functions (WSL edition) into `~/.SearchFunctions`

The scripts call each other through the fixed path `~/.SearchFunctions`, so the folder name matters.

```bash
git clone https://github.com/bilalakbana/search-functions-wsl.git ~/.SearchFunctions
```

If the clone asks for a username or fails with *Repository not found*, the repo is private: run
`gh auth login` (GitHub.com, HTTPS, log in with a web browser), then
`gh repo clone bilalakbana/search-functions-wsl ~/.SearchFunctions`.

**Check:** `ls ~/.SearchFunctions/sub-functions/windows_action` exists, and `command -v powershell.exe`
prints a path (Windows interop; Enter / Ctrl-E / Ctrl-C of the search functions need it).

## 10. zsh as the login shell, first start  (user runs)

```bash
chsh -s /usr/bin/zsh
```

Then ask the user to open Ghostty (Windows Start menu: *Ghostty (Ubuntu)*, or run `ghostty &` in a WSL
shell). On its first start zsh4humans downloads its plugins and powerlevel10k; tmux starts automatically.

**Check:** in the new Ghostty window, the prompt is the powerlevel10k prompt, `echo $SHELL` is
`/usr/bin/zsh`, the tmux status bar is at the bottom, and `f`, `ugrep-fzf` and `gfzf` exist (`whence f`).

## 11. Neovim + LazyVim

The PC uses the unchanged LazyVim starter (no extras).

```bash
[ -e ~/.config/nvim ] && mv ~/.config/nvim ~/.config/nvim.bak-$(date +%F-%H%M%S)
git clone https://github.com/LazyVim/starter ~/.config/nvim
nvim --headless "+Lazy! sync" +qa
```

**Check:** `nvim --headless "+checkhealth lazyvim" "+w! /tmp/lazyvim-health.txt" +qa` and read the file:
there must be no `ERROR` lines (warnings about optional tools are fine).

## 12. Claude Code: theme, workspace pane, CLAUDE.md, plugins, skills

First the skills from other repositories, with the versions of the Linux PC on 2026-10-23. Do this before
the links below: `graphify install` adds a block to `~/.claude/CLAUDE.md`, and the link step then backs up
that file and links Bilal's `CLAUDE.md` (the Linux PC has no graphify block in it either).

```bash
npx -y skills@1.7.4 add vercel-labs/skills --skill find-skills -g -a claude-code -y
npx -y skills@1.7.4 add addyosmani/agent-skills --skill interview-me --skill spec-driven-development -g -a claude-code -y
npx -y skills@1.7.4 add blader/humanizer --skill humanizer -g -a claude-code -y
npx -y skills@1.7.4 add nateherkai/scroll-craft --skill scroll-craft -g -a claude-code -y
npx -y skills@1.7.4 add remotion-dev/skills -g -a claude-code -y --skill remotion-best-practices \
  --skill remotion-captions --skill remotion-create --skill remotion-docs --skill remotion-interactivity \
  --skill remotion-maps --skill remotion-markup --skill remotion-multimedia --skill remotion-render \
  --skill remotion-saas --skill remotion-studio --skill remotion-upgrade
pipx install graphifyy==0.9.92
graphify install --platform claude
```

**Check:** `ls ~/.claude/skills` shows 18 folders: `find-skills`, `interview-me`, `spec-driven-development`,
`humanizer`, `scroll-craft`, `graphify` and the 12 `remotion-*` folders.

The side pane (context, limits, git status, folder tree) is the *workspace* mod in `.claude/mods`, a
folder marketplace called `bilal-mods`; Claude Code reads it straight from that folder. It needs the
fullscreen UI. Link the mod folder, the theme, the global `CLAUDE.md` and Bilal's own skills (`format`,
`autopilot`) into `~/.claude` (same rules as step 8). An existing `~/.claude/CLAUDE.md` is backed up:
tell the user, because it can hold rules for the work computer that they want to keep.

```bash
mkdir -p ~/.claude/themes ~/.claude/skills
cd ~
for f in .claude/mods .claude/themes/catppuccin-macchiato.json .claude/CLAUDE.md \
         .claude/skills/format .claude/skills/autopilot; do
  if [ -L "$f" ]; then
    [ "$(readlink "$f")" = "$HOME/.dot-files/$f" ] || echo "a different link, left alone: $f -> $(readlink "$f")"
    continue
  fi
  if [ -e "$f" ]; then b="$f.bak-$(date +%F-%H%M%S)"; mv -- "$f" "$b" && echo "backed up: $b"; fi
  ln -s "$HOME/.dot-files/$f" "$f"
done
```

Settings in `~/.claude/settings.json`, every other key kept (a dated copy is made first): the fullscreen
UI, the theme, no Claude attribution in commits and PRs (the `CLAUDE.md` forbids it), and the skills that
start only when the user types their name:

```bash
f=~/.claude/settings.json
[ -f "$f" ] || echo '{}' > "$f"
cp -- "$f" "$f.bak-$(date +%F-%H%M%S)"
by_name='["format","graphify","remotion-captions","remotion-create","remotion-docs","remotion-interactivity",
  "remotion-maps","remotion-markup","remotion-multimedia","remotion-render","remotion-saas","remotion-studio",
  "remotion-upgrade"]'
jq --argjson s "$by_name" '.tui = "fullscreen" | .theme = "custom:catppuccin-macchiato"
  | .attribution = {commit: "", pr: "", sessionUrl: false}
  | .skillOverrides = ((.skillOverrides // {}) + ($s | map({key: ., value: "user-invocable-only"}) | from_entries))' \
  "$f" > "$f.new" && mv -- "$f.new" "$f"
```

Plugins. A fresh Claude Code knows only its built-in directory, so the official marketplace is added first
(if it says the marketplace already exists, go on):

```bash
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add DietrichGebert/ponytail
claude plugin marketplace add nextlevelbuilder/ui-ux-pro-max-skill
claude plugin marketplace add ~/.claude/mods
for p in context7 claude-code-setup playground pyright-lsp frontend-design; do
  claude plugin install "$p@claude-plugins-official" --scope user
done
claude plugin install ponytail@ponytail --scope user
claude plugin install ui-ux-pro-max@ui-ux-pro-max-skill --scope user
claude plugin install workspace@bilal-mods --scope user
```

`pyright-lsp` only works once `pyright-langserver` is on PATH (`sudo npm install -g pyright`). The Linux
PC has it; ask the user before installing it.

**Check:** `claude plugin list` shows the eight plugins enabled, `workspace@bilal-mods` with
`Read from: /home/<user>/.claude/mods/workspace`, `ls -l ~/.claude/CLAUDE.md` shows a link into
`~/.dot-files`, and `jq '{tui, theme, attribution, skillOverrides}' ~/.claude/settings.json` shows
`fullscreen`, `custom:catppuccin-macchiato`, the empty attribution and the 13 skills. Then ask the user to quit Claude Code and start it again
(the UI mode and the theme apply to new sessions): the Catppuccin colours show, and the pane opens on its
own in a window at least 144 columns wide, or with `/workspace` at any width. In the pane, a text file
opens read-only in nvim in a tmux popup; any other file opens in its Windows default app (through
`~/.SearchFunctions/sub-functions/windows_action`).

## 13. WSL notes

- **systemd:** `~/.zshrc` starts the tmux server in its own systemd scope when a systemd user session
  exists (`systemctl --user show-environment` succeeds) and without it otherwise; both work.
- **Clipboard / opening files:** the search functions use `~/.SearchFunctions/sub-functions/windows_action`
  (PowerShell) for Enter (open with the Windows default app), Ctrl-E (show in Explorer) and Ctrl-C (copy the
  Windows path). Windows interop must stay on (`/etc/wsl.conf` must not set `enabled=false` or
  `appendWindowsPath=false` under `[interop]`).
- **Ghostty window:** `maximize = true` and `window-decoration = none` in `~/.config/ghostty/config`; if the
  window cannot be moved or resized under WSLg, set `window-decoration = auto` there.
