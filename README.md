# Collision Simulation Viewer

Browser-based 3D visualisation for vehicle crash simulations, built with
React + Three.js.

There are two things in here:

- a **single-simulation viewer** — the original tool, for exploring one
  LS-DYNA run node by node;
- a **truth-vs-prediction comparison view** — two panels side by side, FEM
  ground truth against a surrogate model's prediction, on the same node set
  and the same frames.

---

## Pages

| URL | What it shows |
|-----|---------------|
| `/` | Single simulation. Track / Mesh / Inspect tabs. |
| `/?surface=<case>` | Comparison, rendered as a shaded surface. |
| `/?points=<case>` | Comparison, rendered as the raw sampled point cloud. |

`<case>` is a case id from `collision-viewer/public/cases.json`, e.g.
`model_100km`.

---

## Data files

> **The repository contains no simulation data — the files are far too large.
> Place them manually.**

### Single-simulation viewer

| File | Path | Size |
|------|------|------|
| `collision_light.bin` | `collision-viewer/public/` | ~151 MB |

Produced from the raw d3plot files by `extract_data.py`:

```bash
python extract_data.py
cp collision_light.bin collision-viewer/public/
```

### Comparison view

Each case needs three files in `collision-viewer/public/`:

| File | Contents |
|------|----------|
| `<case>_gt.bin` | FEM ground truth, coloured by plastic strain |
| `<case>_pred.bin` | Model prediction, coloured by position error |
| `<case>_meta.json` | Node/frame counts, field scales, region spacing, part table |

These come from the surrogate-model repository, not this one — its
`tools/h5_to_col2.py` converts a trajectory h5 plus a rollout result into the
pair above. Both `.bin` files and the generated `_meta.json` are gitignored.

### The case manifest

`collision-viewer/public/cases.json` lists which condition combinations exist.
The condition dropdowns are built from it — nothing is hardcoded in the
front-end — so a new simulation only needs an entry appended:

```json
{ "id": "t_lok_60", "status": "ready", "validated": true,
  "speed_kmh": 60, "angle_deg": -25.4, "barrier": "t_lok",
  "checkpoint": "wj09_r3" }
```

`status` is deliberately three-valued, because each state implies a different
next action:

| status | Meaning | Shown as |
|--------|---------|----------|
| `ready` | The `.bin` files are present | selectable |
| `pending` | The LS-DYNA run exists, but the viewer data has not been generated | disabled, "simulated, viewer data pending" |
| *absent* | No simulation for this combination | disabled, "not yet simulated" |

An option that appears to work but silently returns another condition's result
is worse than one that explains itself, so unavailable values stay visible with
their reason.

---

## Quick start

### Front-end only

```bash
cd collision-viewer
npm install
npm run dev
```

Then open one of:

- <http://localhost:5173> — single simulation
- <http://localhost:5173/?surface=model_100km> — comparison

### With the FastAPI backend (optional)

The backend serves simulation files from an S3-compatible bucket through
time-limited signed URLs. Only the single-simulation viewer uses it.

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # then fill in the credentials below
uvicorn main:app --reload --port 8000
```

API at <http://localhost:8000>, interactive docs at `/docs`.

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT_URL` | `""` | Blank for AWS S3; set for OSS/MinIO |
| `S3_ACCESS_KEY` | `""` | Access key ID |
| `S3_SECRET_KEY` | `""` | Secret access key |
| `S3_REGION` | `us-east-1` | Ignored by OSS |
| `S3_BUCKET` | `""` | Bucket holding the `.bin` files |
| `S3_PREFIX` | `""` | Key prefix, e.g. `simulations/` |
| `SIGNED_URL_EXPIRES` | `3600` | Signed URL lifetime, seconds |
| `CORS_ORIGINS` | `localhost:5173,5174` | Allowed front-end origins |

With `S3_BUCKET` or `S3_ACCESS_KEY` empty the simulation list returns empty and
the backend still starts cleanly.

To enable backend mode, create `collision-viewer/.env.local`:

```
VITE_API_BASE_URL=http://localhost:8000
```

---

## Comparison view

**One shared camera.** Both panels are driven by the same orbit state, and it
tracks the ground-truth vehicle as it travels. A comparison seen from two
different angles is worse than none; and with each panel following its own car,
the model's drift would be invisible. Here it shows up as the prediction
sliding off centre.

**Colouring modes**

| Mode | What it does |
|------|--------------|
| Field | Each panel's own quantity — plastic strain on one side, position error on the other. Different units, different scales, and deliberately different colour ramps. Not comparable. |
| Error | Both panels coloured by \|prediction − truth\| in mm on one shared scale. This is the like-for-like view. |
| Assembly | Coloured by functional assembly — hood, doors, barrier. |
| Region | Coloured by the sampler's six regions. |

The colour ramp is switchable. **Spectrum** has the most contrast on screen;
**Cividis** is colour-blind safe and survives greyscale printing, so use it for
anything published.

**Two render paths**

*Surface* draws a shaded skin, and is the one to show people. It never
reconstructs geometry: each node is splatted as a shaded sphere, the depth
buffer is blurred bilaterally so splats fuse across a surface but not across
silhouettes, and normals come from the smoothed depth. Deformation is therefore
free — every frame is rebuilt from the positions currently in the buffer — and
uneven sampling density is absorbed by the blur instead of having to be fixed
in the data.

*Points* draws the sampled nodes directly. Point size follows each region's
measured node spacing, so no region smears into a solid while another scatters
into confetti. The `grain` slider thins the finely-sampled regions toward a
common spacing; it trades collision-zone detail for an even texture, and at the
far end `veh_contact` keeps one node in 31.

---

## Tech stack

React 19 · TypeScript · Vite · Three.js · Zustand · FastAPI + boto3 (optional
backend).

---

## Project structure

```
visualization/
├── collision-viewer/              # React + TypeScript front-end
│   ├── public/
│   │   ├── cases.json             # case manifest — drives the condition dropdowns
│   │   └── *.bin, *_meta.json     # simulation data (gitignored)
│   └── src/
│       ├── components/
│       │   ├── SurfaceView/       # comparison, shaded surface
│       │   ├── PointsView/        # comparison, point cloud
│       │   ├── CaseSelector.tsx   # condition dropdowns
│       │   ├── Sidebar/           # single-sim tabs: Track / Mesh / Inspect
│       │   ├── Chart/             # sparkline and modal stress-history charts
│       │   ├── Viewer/            # single-sim Three.js canvas
│       │   └── Controls/          # single-sim playback bar
│       ├── hooks/
│       │   ├── useThreeScene.ts   # single-sim scene
│       │   └── usePlayback.ts     # rAF playback loop
│       ├── lib/
│       │   ├── surfacePass.ts     # screen-space surface rendering
│       │   ├── compareData.ts     # COL2 pair loader
│       │   ├── cases.ts           # case manifest types and lookup
│       │   ├── partGroups.ts      # 704 parts → 20 functional assemblies
│       │   ├── colors.ts          # Spectrum / Cividis / error ramps
│       │   ├── parseBin.ts        # single-sim COL2 parser
│       │   └── api.ts             # backend REST client
│       └── store/useStore.ts      # Zustand state (single-sim)
├── backend/                       # FastAPI: simulation list + signed URLs
├── extract_data.py                # d3plot → COL2, for the single-sim viewer
└── README.md
```
