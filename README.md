# Knowledge Hub

A personal knowledge hub that transforms scattered notes, links, and ideas into structured, searchable intelligence using AI.

_This README is maintained by `evolve.sh` and refreshed after successful automated work._

## Overview
- Vanilla JavaScript knowledge capture app
- Local-first storage with AI-assisted summarization
- Vercel-compatible API handlers plus a local Node dev server
- Automation workflow that prioritizes GitHub issues before new feature work

## Status
- Current phase: `phase3-visualization`
- Current branch: `evolve/mvp-mvp-capture-recall`
- Completed tasks: `18`
- Completed issues: `2`

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
- `mvp-deploy-check`: Deployment verification
- `p2-auto-tag`: Auto-tag on save
- `p2-related-notes`: Related notes suggestions
- `p3-graph-data`: Graph data model
- `p3-graph-view`: Force-directed graph visualization
- `p3-timeline`: Learning timeline
- `p3-clustering`: Topic clustering

## Recent Changes
- `c32ad08 evolve(p3-clustering): Topic clustering`
- `2483199 evolve(p3-timeline): Learning timeline`
- `c80efe1 evolve(p3-graph-view): Force-directed graph visualization`
- `0d218d9 evolve(p3-graph-data): Graph data model`
- `e3941a6 evolve(p2-related-notes): Related notes suggestions`

## What's Next
- No pending actionable GitHub issue detected.
- Next manifest task candidate: `mvp-summarize-ui` in phase `mvp` — Summarize button and flow
- Next manifest task candidate: `mvp-polish` in phase `mvp` — UI polish and error handling
- Next manifest task candidate: `p2-key-insights` in phase `phase2-intelligence` — Key insight extraction
- Next manifest task candidate: `p2-chrome-extension` in phase `phase2-intelligence` — Chrome extension scaffold
- Next manifest task candidate: `p4-voice` in phase `phase4-multimodal` — Voice note capture

## Resolved Issues
- `#2`
- `#3`

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
