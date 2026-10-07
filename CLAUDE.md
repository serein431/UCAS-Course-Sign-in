# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```
npm run dev      # Start dev server (Turbopack)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

`npm test` runs local mocked tests and never accesses the school or submits real attendance.

## Architecture

A single-page Next.js 16 App Router app for UCAS (国科大) students to query courses and generate auto-refreshing QR sign-in codes. Uses `iclass.ucas.edu.cn:8181` as the upstream API for authentication, course schedules, timestamps, and sign-in actions.

### Route map

| Route | Method | Purpose |
|---|---|---|
| `/` | — | Client-side SPA (see `src/app/page.tsx`) |
| `/api/course-uuid/session` | GET / POST / DELETE | Restore / create / revoke encrypted server-side sessions with opaque HttpOnly cookies |
| `/api/course-uuid/query` | POST | Saved school session + fetch course schedule → filterable meeting list |
| `/api/course-uuid/timestamp` | GET | Fetch server timestamp for clock synchronization |
| `/api/course-uuid/sign` | POST | Saved school session + direct sign-in for a selected meeting |

### Key patterns

- **Server timestamp sync**: The page calls `/api/course-uuid/timestamp` on mount and caches the offset in `timeOffsetRef`. All QR deadlines and sign-in timestamps use `Date.now() + offset` so the server's clock, not the client's, drives validity windows.
- **QR auto-refresh**: QR codes encode a sign-in URL with an embedded timestamp. They regenerate every 5 seconds (`AUTO_QR_TTL_MS`). Downloaded QR codes embed a 10-second deadline (`DOWNLOAD_QR_TTL_MS`).
- **Dual mode**: The UI has two modes — "query" (login → browse courses → generate QR / sign in) and "manual" (paste a 7-digit course ID or 32-char hex UUID directly).
- **Rate limiting**: In-memory per-IP rate limiting on the `/query` and `/sign` routes (5-min sliding window + daily cap), configurable via `RATE_LIMIT_5M_MAX` / `RATE_LIMIT_DAILY_MAX` env vars. The store is periodically swept to evict stale entries.
- **Origin check**: POST routes reject cross-origin requests (compares `Origin` header to `Host`).
- **Theme**: Light/dark/system with an inline `<Script>` (blocks render to prevent FOUC) and localStorage persistence under `ucas-theme-mode`.
- **CSS**: Tailwind CSS v4 via `@tailwindcss/postcss`, with custom properties (`--font-serif`, `--green`, `--line`, `--muted`, etc.) defined in `src/app/globals.css`. BEM-style component classes (`.action-btn`, `.status-banner`, `.clay-card`, `.status-chip`) supplement utility classes.
- **API proxy pattern**: All three route handlers mimic the official Android app's User-Agent strings and request/response shapes, acting as a thin proxy between the browser and the upstream iClass API.

Session keys and encrypted records are runtime-only files outside releases. Never log credentials or cookie values, copy `.local` into builds, or test using real user passwords. Login credentials are accepted by legacy query/sign calls for CLI compatibility; the web UI sends passwords only to `/session` at explicit login.
