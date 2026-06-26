# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the server

```bash
nvm use 20   # required — better-sqlite3 prebuilt binaries target Node 20
npm install  # first time only
node server.js
```

Starts on port 3000. Accessible locally at `http://localhost:3000` and over LAN at the printed IP. `game.db` (SQLite) is created automatically on first run.

## Architecture

**Single-file server** (`server.js`) + **single-file frontend** (`index.html`) with all CSS and JavaScript inline. No build step, no bundler.

### server.js

One Node.js `http.createServer` handler routing by path pattern. Two game namespaces:

| Prefix | Game |
|---|---|
| `/api/room`, `/api/events/:code`, `/api/move/:code`, `/api/reset/:code` | Cờ Caro (Gomoku) |
| `/api/wg/*` | Nối Từ (Word Chain) |

Real-time multiplayer uses **Server-Sent Events** (SSE). Each room holds a `clients` Map of open SSE response objects; `broadcast()` writes to all of them.

Room state lives in two in-memory Maps (`rooms`, `wgRooms`) — no database. A GC interval runs every 15 min and removes rooms inactive > 2h with no connected clients.

Room codes are 4-char uppercase alphanumeric (charset excludes visually ambiguous characters: `0`, `1`, `I`, `O`).

### index.html

Single-page app. Two full-screen overlays (`#game-overlay` for Cờ Caro, `#wg-overlay` for Nối Từ) slide over the home screen. Each overlay has multiple `<div class="ov-screen">` panels (mode → lobby → game) toggled by `display` class.

State is plain JS variables at module scope — no framework. SSE events from the server drive all multiplayer UI updates.

## Game rules summary

**Cờ Caro**: First to place 5 in a row (horizontal/vertical/diagonal) wins. Board is NxN, 8–25 (default 15). Win check is server-authoritative.

**Nối Từ**: Players chain Vietnamese 2-syllable words where each word must start with the last syllable of the previous word. 30-second turn timer. Failing to answer or forfeiting (bỏ qua) eliminates the player. Last player standing wins.

## Vietnamese dictionary

`data/Viet74K.txt` — one word per line, space-separated syllables. Server loads only 2-syllable words (no hyphens) into `wgWordSet` at startup. The `/api/wg/dict` endpoint serves this set to the client for local caching. If the file is missing, the server falls back to regex-based Vietnamese syllable validation.
