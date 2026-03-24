Plan: Full pipeline from data processing to web visualization

Problem statement
- Goal: Build a complete pipeline to visualize large d3plot datasets, addressing two primary challenges:
  1. Very large data files (memory, storage, network transfer)
  2. Mesh issues after processing (non-manifold geometry, poor quality, collisions)

High-level approach
1. Data processing (Python)
   - Implement data compression and resampling strategies that preserve important features while reducing size.
   - Produce multiple fidelities / progressive representations (coarse → medium → fine) to enable progressive loading in the browser.
   - Validate mesh integrity and detect/fix common mesh problems (duplicate vertices, small fragmented components, inverted faces).
   - Generate metadata (bounding boxes, timestamps, per-frame summaries, collision indicators) and lightweight index files for fast lookup.

2. Backend service (Node/Express)
   - Serve metadata and progressive data chunks via REST endpoints (e.g., /api/metadata, /api/frames/:frameId, /api/mesh/:id?level=coarse).
   - Support range/byte requests and gzip compression for binary transfers.
   - Provide a simple caching layer (filesystem + memory LRU stub) to speed repeated requests.

3. Frontend (Vite + vtk.js)
   - Progressive fetch: load metadata, render low-fidelity mesh quickly, stream higher fidelity asynchronously.
   - Visual debugging tools to inspect mesh quality and collisions (wireframe, normals, bounding boxes, vertex counts).
   - UI controls for playback, fidelity selection, and toggling collision visualization.

Phases and deliverables
A. Prototype (fast):
   - Python: script that reads a single d3plot, produces a 3-level reduced mesh set plus metadata for the first N frames.
   - Backend: minimal Express endpoints to serve static metadata and files from a directory.
   - Frontend: simple viewer that loads metadata and displays the coarse mesh.

B. Robustify:
   - Improve compression: combine spatial partitioning (voxel downsample) with topology-aware decimation for meshes.
   - Mesh repair pipeline: remove degenerate faces, weld near-duplicate vertices, ensure consistent winding.
   - Add streaming / chunked delivery and progressive refinement on the frontend.

C. Validation & Iteration:
   - Build automated mesh checks (non-manifold edges, isolated components, inverted normals) and a visual QA UI.
   - Iterate: fix problems, re-run exporters, rerun web checks.

Implementation tasks (todos)
- data-compression: Implement Python exporter with multi-fidelity outputs, mesh repair and metadata generation.
- backend-api: Create Express routes to serve metadata and binary/chunked mesh data; add caching and gzip support.
- frontend-visualization: Build Vite + vtk.js frontend with progressive loading, collision visualization, UI controls.
- validation-suite: Tools to automatically check mesh quality and a small harness to capture test cases.
- integration-and-deploy: Integration scripts to run exporters, start server, and host preview locally (and optionally Dockerfile).

Execution plan and agent strategy
- Use specialized sub-agents for each major area (data, backend, frontend). Each agent will:
  - Run locally in repository context
  - Create or modify scripts under `scripts/` or `exporters/`, add server routes under `server/`, and add frontend components under `frontend/src/`
  - Run unit/functional checks (small sample frames) and report outputs
- Iterative loop: after each full prototype run, validate collisions visually in the frontend, report failures, and re-run mesh repair heuristics until quality targets are met.

Practical choices and constraints
- Work on samples first (e.g., first 5 frames) to iterate quickly before scaling to all frames.
- Use file-based progressive outputs: e.g., `out/bin/frame_000_coarse.bin`, `frame_000_med.bin`, `frame_000_fine.bin` plus `metadata.json` that lists frames and levels.
- Use gzip-compressed binary payloads for network efficiency; provide Content-Encoding headers.

Next steps to start implementation (automatic)
1. Create `scripts/export_pipeline.py` that reads a sample d3plot and writes progressive levels and metadata for first N frames.
2. Add minimal express endpoints in `server/server.js` if not present (or extend) to serve `/api/metadata` and `/api/frame/:id?level=`.
3. Add a simple frontend demo page `frontend/src/components/ProgressiveViewer.vue` (or `main.js`) to load metadata and render coarse frame.
4. Run the prototype: process sample frames, start server, open frontend preview, and inspect collisions.

Plan file location
- Saved to session-state: /Users/xujiaqing/.copilot/session-state/dfe42b92-8417-4f8c-b6e1-444a6392f17b/plan.md

EOF