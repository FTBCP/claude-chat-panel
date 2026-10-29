# Claude chat panel

A side panel for the Claude desktop app that lists your Claude Code chats by project. Each chat shows where it left off in a few words, and a red line appears when Claude is waiting on you. It's built for people who run several Claude Code chats at once and lose track of which ones finished.

## What it does

- **Cards by project.** Chats from the last 24 hours, up to 5 per project, each with a short summary of where it left off
- **Action line.** A red "→" line when Claude asked you a question or listed something you need to do
- **Working state.** "Working on: ..." while Claude is still busy in a chat
- **Click to open.** Click anywhere on a card to jump to that chat
- **Older chats.** "Show older chats" under each project lists every chat in it, 20 at a time
- **Search.** Filter all your chats by name
- **New.** Opens a blank new chat in the folder you used last
- **Pin (☆), rename (✎) and hide (✕)** on each card. A hidden chat comes back the next time you type in it
- **Move (⇅).** Click ⇅ on a project or a chat, then click the project or chat it should take the place of. Chats move within their own project. Projects and chats you haven't placed yet show on top
- **Context meter.** How full each chat's context window is, next to its name, in red from 80%
- **Plan limits.** Your 5-hour and weekly limits at the bottom, with when each resets, in red from 80%. They update with each reply
- **Collapse.** Click a project name to fold it away

Archived chats and routine runs stay off the panel.

## Install

In the Claude desktop app's Code tab:

1. Click **+** next to the message box, then **Plugins**
2. Choose **Add marketplace** and enter `FTBCP/claude-chat-panel`
3. Add the **chat-panel** plugin
4. Quit and reopen the Claude app

From a terminal instead:

```bash
claude plugin marketplace add FTBCP/claude-chat-panel
claude plugin install chat-panel@claude-chat-panel
```

If `claude plugin list` then says "failed to load" with "expected record", your terminal's `claude` is older than the desktop app's. The panel still loads in the desktop app. Run `claude update` to clear the message.

The panel opens on the right side of each chat. If it's closed, type `/chats` in a chat to bring it back.

## Update

When a new version is out, run this in a terminal, then quit and reopen the Claude app:

```bash
claude plugin update chat-panel@claude-chat-panel
```

## Settings

Both are optional. Set them in the plugin's settings in the desktop app, or with `claude plugin configure chat-panel@claude-chat-panel`.

- **Project order:** project colors, and the order to start with, like `client-work:#378ADD, personal:#7F77DD`. Other projects follow, newest first, with colors picked automatically. Once you move a project with ⇅, the order you set in the panel wins
- **Chat records folder:** leave it blank. Fill it in only if "Show older chats" and search come up empty, with the `claude-code-sessions` folder where your desktop app keeps its chat records

## How it works

Each chat writes a small status file to `~/.claude/chat-panel/` when a turn starts and ends. The short summaries come from one quick request to Claude's smallest model, Haiku, per reply. Older chats come from the records the desktop app keeps for every chat, read on your own computer. Nothing is sent anywhere else.

## Requirements and limits

- The Claude desktop app on Windows or macOS, with chats in its Code tab
- It's been used on Windows. The macOS version follows the same steps but hasn't been tested yet
- Chats that are already open when you install or update keep the old version until you reopen the app
- Opening chats and renaming them go through the desktop app, so they don't work in a plain terminal session
