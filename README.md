# Knowledge Hub

A personal knowledge hub that transforms scattered notes, links, and ideas into structured, searchable intelligence using AI.

_This README is maintained by `evolve.sh` and refreshed after successful automated work._

## Overview
- Vanilla JavaScript knowledge capture app
- Local-first storage with AI-assisted summarization
- Vercel-compatible API handlers plus a local Node dev server
- Automation workflow that prioritizes GitHub issues before new feature work

## Status
- Current phase: `mvp`
- Current branch: `evolve/mvp-mvp-capture-recall`
- Completed tasks: `1`
- Completed issues: `0`

## Implemented
- `mvp-scaffold`: Project scaffold

## Recent Changes
- `c98702d evolve(p6-sharing): Note sharing`
- `886a116 evolve(p5-health): Knowledge health score`
- `22c31d6 evolve(p5-reminders): Smart revisit reminders`
- `5845a08 evolve(p5-patterns): Learning pattern analysis`
- `844f4ee evolve(p4-pdf): PDF upload and extraction`

## What's Next
- No pending actionable GitHub issue detected.
- Next manifest task candidate: `mvp-capture-ui` in phase `mvp` — Capture interface
- Next manifest task candidate: `mvp-storage-layer` in phase `mvp` — LocalStorage persistence
- Next manifest task candidate: `mvp-summarize-api` in phase `mvp` — AI summarization serverless function
- Next manifest task candidate: `mvp-summarize-ui` in phase `mvp` — Summarize button and flow
- Next manifest task candidate: `mvp-link-fetch-api` in phase `mvp` — Link metadata fetcher

## Journal
- Project history and live automation notes: [JOURNAL.md](./JOURNAL.md)

## Development
```bash
cd app
npm install
npm run dev
```

Environment variables:
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (defaults to `gemini-3-flash-preview`)

## Automation Workflow
- `evolve.sh` checks pending actionable GitHub issues before manifest tasks.
- Successful runs update the journal and refresh this README.
- Work is separated onto task or issue branches instead of accumulating on one branch.
