# demo.tape — VHS scenario for the qsearch terminal demo.
# Render with charmbracelet/vhs:  vhs scripts/demo.tape   (or: bash scripts/record-demo.sh)
# Docs: https://github.com/charmbracelet/vhs
#
# Output → assets/demo.gif  (the path the README embeds).
# The actual on-screen commands live in scripts/demo-flow.sh — this file only
# drives the recording (window size, theme, typing). Keep the two in sync by
# editing demo-flow.sh, not by re-typing commands here.
#
# Prereqs before recording: qsearch live on :8080 (npm start) + docker compose up -d.
# vhs needs `ttyd` and `ffmpeg` on PATH (installed automatically by Homebrew/scoop
# alongside vhs; record-demo.sh checks for them and tells you if they are missing).

Output assets/demo.gif

# --- terminal aesthetics -----------------------------------------------------
# A soft near-black background + warm off-white foreground (no pure #000/#fff):
# easier on the eye and keeps the GIF from looking like raw slop.
Set Theme { "name": "qsearch", "background": "#141518", "foreground": "#e8e6df", "cursor": "#e2b340", "selection": "#2a2d34", "black": "#141518", "red": "#e06c63", "green": "#7bbf6a", "yellow": "#e2b340", "blue": "#5aa6e0", "magenta": "#b07cd6", "cyan": "#56c2c0", "white": "#e8e6df", "brightBlack": "#5a5d66", "brightRed": "#e06c63", "brightGreen": "#7bbf6a", "brightYellow": "#e2b340", "brightBlue": "#5aa6e0", "brightMagenta": "#b07cd6", "brightCyan": "#56c2c0", "brightWhite": "#f5f3ec" }

Set FontSize 17
Set Width 1180
Set Height 760
Set Padding 22
Set MarginFill "#0e0f12"
Set Margin 14
Set BorderRadius 10
Set TypingSpeed 18ms
Set PlaybackSpeed 1.0
Set Shell "bash"

# --- recording ---------------------------------------------------------------
# A short settle so the GIF does not open mid-frame.
Sleep 600ms

# Run the scenario. demo-flow.sh prints its own faux prompts + commands and
# paces itself via QS_TYPE_DELAY, so we just launch it and let it play.
Type "bash scripts/demo-flow.sh"
Enter

# demo-flow.sh runs three curls (health → sweep → verify); /verify can take a few
# seconds (LLM-as-judge). Give the whole flow room to finish on screen.
Sleep 18s
