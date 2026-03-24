# Copilot instructions for this repository

This file provides repository-specific guidance to help Copilot/CLI sessions work effectively here.

## Build, test, and lint commands
- Frontend (Vite + @kitware/vtk.js)
  - Install: `npm --prefix frontend install`
  - Dev server (single-run): `npm --prefix frontend run dev` (Vite default port: 5173)
  - Build: `npm --prefix frontend run build`
  - Preview (static): `npm --prefix frontend run preview`
  - Single test (if tests added): run your test runner from `frontend/`, e.g. `npm --prefix frontend test -- -t "pattern"` or `vitest -t "pattern"`.

- Server (Node/Express)
  - Install: `npm --prefix server install`
  - Start (dev/test): `node server/server.js` (listens on port 3001)
  - Endpoints of interest: `GET /api/health`, `GET /api/metadata`
  - Single test (if tests exist): run from `server/`, e.g. `npm --prefix server test -- -t "pattern"`.

- Python scripts (data processing / exporters)
  - Activate virtualenv if present: `source .venv/bin/activate`
  - Run an exporter: `python export_v3.py` (run from repository root)
  - Single test: run `pytest -k "pattern"` if tests are added under `python/` or `scripts/`.

## High-level architecture
- Top-level contains large binary timestep files named `d3plot*` (these are the primary dataset files used by exporters and viewers).
- Exporters (Python): scripts convert `d3plot` inputs into binary and VTP outputs (e.g., `bin_output_v3`, `vtp_output_v2`).
- Frontend: Vite-based SPA using vtk.js for visualization. Built assets previously live under `frontend/dist` when built.
- Server: lightweight Express server that serves metadata and mounts static output directories. It exposes `GET /api/metadata` which prefers `bin_output_v3/metadata.json` and static mounts such as:
  - `/data_v2` → `vtp_output_v2`
  - `/bin_v2` → `bin_output_v2`
  - `/bin_v3` → `bin_output_v3`

## Key conventions and patterns
- Large binary data files (`d3plot*`) are kept at repository root for convenience; other generated outputs go to `vtp_output_v2`, `bin_output_v2`, and `bin_output_v3`.
- When running frontend or server commands from repo root, prefer `npm --prefix <dir> <cmd>` to avoid changing directories.
- Exporter scripts assume a Python virtual environment may exist at `.venv` and that large outputs may be written under the `vtp_output_*` or `bin_output_*` directories.
- There are no repository-wide test suites by default; add focused tests under `frontend/` or `server/` and call them via the `--prefix` pattern shown above to run a single test.

## Existing AI assistant configs checked
- Searched for common assistant config files (CLAUDE.md, .cursorrules, AGENTS.md, .windsurfrules, AIDER_CONVENTIONS.md, .clinerules). None were found; add them here if present later.

## How Copilot sessions should behave here
- Prioritize small, surgical edits and avoid touching large `d3plot*` files.
- When adding or modifying build configs, ensure `npm --prefix` patterns work from repo root.
- Prefer editing exporter scripts in-place; when adding new outputs, document new output paths in this file.


---
Generated and committed by Copilot CLI.
