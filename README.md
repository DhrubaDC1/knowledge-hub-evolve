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
- Completed tasks: `6`
- Completed issues: `0`

## Implemented
- `mvp-capture-ui`: Capture interface
- `mvp-scaffold`: Project scaffold
- `mvp-storage-layer`: LocalStorage persistence
- `mvp-summarize-api`: AI summarization serverless function
- `mvp-link-fetch-api`: Link metadata fetcher
- `mvp-link-save-flow`: Link auto-fetch on save

## Recent Changes
- `92f0d1a evolve(mvp-link-fetch-api): Link metadata fetcher`
- `8999b9b Add project README and journal`
- `863dc96 Switch summarization to Gemini and fix local dev API`
- `22b70b8 evolve(mvp-summarize-api): AI summarization serverless function`
- `cae443e evolve(mvp-storage-layer): LocalStorage persistence`

## What's Next
- No pending actionable GitHub issue detected.
- Next manifest task candidate: `mvp-summarize-ui` in phase `mvp` — Summarize button and flow
- Next manifest task candidate: `mvp-semantic-search-api` in phase `mvp` — Semantic search serverless function
- Next manifest task candidate: `mvp-search-ui` in phase `mvp` — Semantic search interface
- Next manifest task candidate: `mvp-tags-ui` in phase `mvp` — Tag system refinement
- Next manifest task candidate: `mvp-tag-suggestions-api` in phase `mvp` — AI tag suggestions

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
