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
- Completed tasks: `11`
- Completed issues: `0`

## Implemented
- `mvp-capture-ui`: Capture interface
- `mvp-scaffold`: Project scaffold
- `mvp-storage-layer`: LocalStorage persistence
- `mvp-summarize-api`: AI summarization serverless function
- `mvp-link-fetch-api`: Link metadata fetcher
- `mvp-link-save-flow`: Link auto-fetch on save
- `mvp-semantic-search-api`: Semantic search serverless function
- `mvp-search-ui`: Semantic search interface
- `mvp-tags-ui`: Tag system refinement
- `mvp-tag-suggestions-api`: AI tag suggestions
- `mvp-tag-suggestions-ui`: Tag suggestions in capture form

## Recent Changes
- `7df55f1 evolve(mvp-tag-suggestions-api): AI tag suggestions`
- `f1f50f2 evolve(mvp-tags-ui): Tag system refinement`
- `db8d951 evolve(mvp-search-ui): Semantic search interface`
- `4ac94a5 evolve(mvp-semantic-search-api): Semantic search serverless function`
- `c9ae9c4 evolve(mvp-link-save-flow): Link auto-fetch on save`

## What's Next
- No pending actionable GitHub issue detected.
- Next manifest task candidate: `mvp-summarize-ui` in phase `mvp` — Summarize button and flow
- Next manifest task candidate: `mvp-polish` in phase `mvp` — UI polish and error handling
- Next manifest task candidate: `mvp-deploy-check` in phase `mvp` — Deployment verification
- Next manifest task candidate: `p2-auto-tag` in phase `phase2-intelligence` — Auto-tag on save
- Next manifest task candidate: `p2-related-notes` in phase `phase2-intelligence` — Related notes suggestions

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
