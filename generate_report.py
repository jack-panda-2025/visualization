"""
Generate Progress Report 3 Handover Document (Word format)
"""
from docx import Document
from docx.shared import Pt, Inches, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import datetime

doc = Document()

# ── Page margins ────────────────────────────────────────────────────────────
section = doc.sections[0]
section.top_margin    = Cm(2.54)
section.bottom_margin = Cm(2.54)
section.left_margin   = Cm(3.17)
section.right_margin  = Cm(3.17)

# ── Helper functions ─────────────────────────────────────────────────────────
def add_heading(text, level=1):
    p = doc.add_heading(text, level=level)
    return p

def add_para(text, bold=False, italic=False, size=11):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    return p

def add_bullet(text, level=0):
    p = doc.add_paragraph(style='List Bullet')
    run = p.add_run(text)
    run.font.size = Pt(11)
    return p

def add_code_block(lines):
    """Add a shaded code block."""
    for line in lines:
        p = doc.add_paragraph()
        p.style = doc.styles['No Spacing']
        run = p.add_run(line)
        run.font.name = 'Courier New'
        run.font.size = Pt(9)
        # light grey shading
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'), 'F2F2F2')
        p._p.pPr.append(shd)

def add_table(headers, rows):
    table = doc.add_table(rows=1+len(rows), cols=len(headers))
    table.style = 'Light Grid Accent 1'
    hdr_cells = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        for run in hdr_cells[i].paragraphs[0].runs:
            run.bold = True
    for row_data in rows:
        cells = table.add_row().cells
        for i, val in enumerate(row_data):
            cells[i].text = val
    doc.add_paragraph()


# ═══════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════
doc.add_paragraph()
doc.add_paragraph()
title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = title.add_run('Collision Simulation Visualizer')
run.bold = True
run.font.size = Pt(22)

subtitle = doc.add_paragraph()
subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
run2 = subtitle.add_run('Progress Report 3 — Handover Document')
run2.font.size = Pt(16)
run2.font.color.rgb = RGBColor(0x44, 0x44, 0x44)

doc.add_paragraph()
meta = doc.add_paragraph()
meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
meta.add_run(f'Date: {datetime.date.today().strftime("%B %d, %Y")}\n')
meta.add_run('GitHub: https://github.com/jack-panda-2025/visualization\n')
meta.add_run('Version: v3.0')

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# TABLE OF CONTENTS (manual)
# ═══════════════════════════════════════════════════════════════════════════
add_heading('Table of Contents', 1)
toc_items = [
    ('2', 'Comprehensive Documentation'),
    ('3', 'Development Environment Setup'),
    ('4', 'Data Management'),
    ('5', 'Testing and Known Issues'),
    ('6', 'Deployment and Infrastructure'),
    ('7', 'Future Work and Recommendations'),
    ('8', 'Video Walkthrough'),
]
for num, title_text in toc_items:
    p = doc.add_paragraph()
    p.add_run(f'Section {num}   {title_text}')
    p.paragraph_format.left_indent = Cm(1)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — COMPREHENSIVE DOCUMENTATION
# ═══════════════════════════════════════════════════════════════════════════
add_heading('2. Comprehensive Documentation', 1)

add_heading('2.1 Project Overview', 2)
add_para(
    'The Collision Simulation Visualizer is a browser-based, interactive 3D tool for '
    'exploring vehicle crash simulation data produced by LS-DYNA finite-element analysis. '
    'The system renders hundreds of thousands of nodes as a real-time animated point cloud, '
    'colour-coded by structural stress metrics (PEEQ or Von Mises), and additionally '
    'constructs convex-hull surface meshes for individual vehicle parts. '
    'A Python pre-processing pipeline compresses raw multi-gigabyte d3plot output into a '
    'compact binary format (~151 MB) suitable for in-browser streaming. '
    'A FastAPI backend optionally serves simulation files from S3-compatible cloud storage '
    'via time-limited signed URLs, enabling secure multi-simulation deployments.'
)

add_heading('2.2 Repository Structure', 2)
add_para('The GitHub repository (jack-panda-2025/visualization) is organised as follows:')
add_code_block([
    'visualization/',
    '├── collision-viewer/          # React + TypeScript front-end',
    '│   ├── public/                # Static assets (place collision_light.bin here)',
    '│   └── src/',
    '│       ├── App.tsx            # Root component, data loading, mode switching',
    '│       ├── components/',
    '│       │   ├── Sidebar/       # TrackView, MeshView, InspectView tabs',
    '│       │   ├── Chart/         # Inline sparkline + modal stress-history chart',
    '│       │   ├── Viewer/        # Three.js canvas & tooltip overlay',
    '│       │   ├── Controls/      # Playback bar (play/pause/scrub)',
    '│       │   ├── SimSelector.tsx# Simulation file picker (backend mode)',
    '│       │   └── Loading.tsx    # Progress screen',
    '│       ├── hooks/',
    '│       │   ├── useThreeScene.ts  # Core Three.js logic',
    '│       │   └── usePlayback.ts    # requestAnimationFrame loop',
    '│       ├── lib/',
    '│       │   ├── parseBin.ts    # Custom COL2 binary parser',
    '│       │   ├── simData.ts     # In-memory simulation data singleton',
    '│       │   ├── partsData.ts   # 864 vehicle part definitions + zone labels',
    '│       │   ├── partColors.ts  # Part colour palette',
    '│       │   ├── constants.ts   # Frame rate, presets, colour ranges',
    '│       │   ├── colors.ts      # Rainbow RGB gradient helper',
    '│       │   └── api.ts         # Backend REST client',
    '│       └── store/',
    '│           └── useStore.ts    # Zustand global state',
    '├── backend/',
    '│   ├── main.py                # FastAPI app (simulation list + signed URLs)',
    '│   ├── storage.py             # S3/OSS/MinIO abstraction (boto3)',
    '│   ├── config.py              # pydantic-settings (.env → Settings)',
    '│   └── requirements.txt       # Python dependencies',
    '├── extract_data.py            # LS-DYNA → COL2 binary converter',
    '├── inspect_d3plot.py          # d3plot inspection utility',
    '├── part_position.py           # Part centroid calculator',
    '└── README.md',
])

add_heading('2.3 Key Modules', 2)

add_heading('2.3.1  Binary Data Format (COL2)', 3)
add_para(
    'The custom COL2 binary format is written by extract_data.py and parsed by '
    'src/lib/parseBin.ts. It stores:'
)
add_bullet('Magic bytes "COL2" (4 bytes)')
add_bullet('Header: n_nodes, n_frames, n_parts (uint32)')
add_bullet('Node positions for every frame as Float32 (x, y, z) × n_nodes × n_frames')
add_bullet('Scalar stress values quantised to uint8 (range 2–255; 0 = no data) × n_nodes × n_frames')
add_bullet('Part ID array (int32 × n_nodes) and Layer array (uint8 × n_nodes)')
add_bullet('Tire geometry section for wheels (centre, axis, radius per part)')

add_para(
    'Scalar values are normalised against the 95th-percentile maximum across all frames '
    'to keep the colour scale robust against extreme outliers. '
    'Node count is reduced from ~1.3 million to ~220,444 via stratified subsampling '
    '(stride varies by part category: structural nodes sampled at 1:1, large body panels '
    'at 1:12 or 1:15).'
)

add_heading('2.3.2  Three.js Scene (useThreeScene.ts)', 3)
add_para(
    'The hook owns a WebGLRenderer, PerspectiveCamera, OrbitControls, and two scene '
    'objects: the point-cloud group (stress / part-colour view) and the mesh group '
    '(convex-hull view). Key design decisions:'
)
add_bullet(
    'Per-frame position and colour updates are applied by writing directly into '
    'BufferAttribute arrays and setting needsUpdate = true, avoiding geometry '
    're-allocation each frame.'
)
add_bullet(
    'Convex hulls are built once with THREE.ConvexGeometry. At build time, each hull '
    'vertex is mapped back to the closest source node index (stored in a meshAnimPartsRef '
    'Int32Array). On every frame tick, those node positions are copied into the hull '
    'geometry — giving animated mesh deformation without re-triangulation.'
)
add_bullet(
    'Solid mesh materials use transparent: false and depthWrite: true to prevent '
    'depth-sorting artefacts (the "watercolour" blending issue) that arise with '
    'overlapping transparent geometry.'
)
add_bullet(
    'updateMeshOpacity() only mutates wireframe child materials, leaving solid mesh '
    'opacity unchanged.'
)

add_heading('2.3.3  State Management (Zustand)', 3)
add_para(
    'Global UI state (current frame, playing flag, hidden parts, tracked points, '
    'active tab, view mode, mesh opacity/wireframe flags, inspect part IDs) is held '
    'in a single Zustand store (src/store/useStore.ts). Components subscribe with '
    'fine-grained selectors to minimise re-renders. The Three.js hook bypasses React '
    're-render cycles entirely by reading useStore.getState() inside the rAF loop.'
)

add_heading('2.3.4  Backend API', 3)
add_para('The FastAPI server exposes three endpoints:')
add_table(
    ['Method', 'Path', 'Description'],
    [
        ('GET', '/health', 'Liveness probe — returns {"status":"ok"}'),
        ('GET', '/api/simulations', 'Lists all .bin files in the configured S3 bucket'),
        ('GET', '/api/simulations/{sim_id}/signed-url', 'Returns a time-limited pre-signed download URL'),
    ]
)
add_para(
    'The front-end detects backend mode via the VITE_API_BASE_URL environment variable. '
    'When undefined, the app loads collision_light.bin directly from the Vite public '
    'directory (local development / static hosting mode).'
)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — DEVELOPMENT ENVIRONMENT SETUP
# ═══════════════════════════════════════════════════════════════════════════
add_heading('3. Development Environment Setup', 1)

add_heading('3.1 Prerequisites', 2)
add_table(
    ['Tool', 'Recommended Version', 'Purpose'],
    [
        ('Node.js', '≥ 18 LTS', 'Front-end build toolchain (Vite)'),
        ('npm', '≥ 9', 'Package management'),
        ('Python', '≥ 3.11', 'Backend server and data pre-processing'),
        ('Git', 'Any recent', 'Source control'),
        ('LS-DYNA / d3plot files', 'Proprietary', 'Raw simulation input (not in repo)'),
    ]
)

add_heading('3.2 Clone the Repository', 2)
add_code_block([
    'git clone git@github.com:jack-panda-2025/visualization.git',
    'cd visualization',
])

add_heading('3.3 Front-End (collision-viewer)', 2)
add_code_block([
    '# 1. Install dependencies',
    'cd collision-viewer',
    'npm install',
    '',
    '# 2. Place the simulation data file',
    '#    Copy collision_light.bin into the public directory:',
    'cp ../collision_light.bin public/',
    '',
    '# 3. Start the development server',
    'npm run dev',
    '',
    '# The app is available at http://localhost:5173',
])
add_para(
    'No .env file is required for local-file mode. The constant USE_BACKEND '
    'in App.tsx evaluates to false when VITE_API_BASE_URL is absent, so the app '
    'skips the simulation selector and loads the local file automatically.'
)

add_heading('3.4 Backend Server (optional)', 2)
add_code_block([
    'cd backend',
    '',
    '# Create and activate a virtual environment',
    'python3 -m venv .venv',
    'source .venv/bin/activate        # Windows: .venv\\Scripts\\activate',
    '',
    '# Install Python dependencies',
    'pip install -r requirements.txt',
    '',
    '# Copy and edit the environment file',
    'cp .env.example .env',
    '# Fill in S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET, etc.',
    '',
    '# Start the API server',
    'uvicorn main:app --reload --port 8000',
])
add_para(
    'The backend is optional. If S3_BUCKET or S3_ACCESS_KEY are left empty, '
    'list_simulations() returns an empty list gracefully (no crash). '
    'CORS is pre-configured to allow http://localhost:5173 and http://localhost:5174.'
)

add_heading('3.5 Enable Backend Mode in the Front-End', 2)
add_para('Create collision-viewer/.env.local with:')
add_code_block([
    'VITE_API_BASE_URL=http://localhost:8000',
])
add_para(
    'With this set, the app shows the SimSelector screen at startup and fetches '
    'simulation data via signed URLs from the backend.'
)

add_heading('3.6 Production Build', 2)
add_code_block([
    'cd collision-viewer',
    'npm run build       # Output in dist/',
    'npm run preview     # Preview the production build locally',
])

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — DATA MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════
add_heading('4. Data Management', 1)

add_heading('4.1 Data Pipeline Overview', 2)
add_para('The data pipeline runs offline and produces the browser-ready binary file:')
add_code_block([
    'LS-DYNA FEA solver',
    '     │',
    '     ▼  d3plot, d3plot01, d3plot02, … (multi-GB)',
    'inspect_d3plot.py  ← exploration / debugging',
    'extract_data.py    ← production converter',
    '     │',
    '     ▼  collision_light.bin  (~151 MB)',
    'collision-viewer/public/  ← served by Vite dev server',
])

add_heading('4.2 Running the Data Extractor', 2)
add_code_block([
    '# Ensure lasso (LS-DYNA Python API) is installed and d3plot files are present',
    'python extract_data.py',
    '',
    '# Output: collision_light.bin in the project root',
    'cp collision_light.bin collision-viewer/public/',
])

add_heading('4.3 Binary Format Details', 2)
add_table(
    ['Section', 'Type', 'Size (approx.)', 'Notes'],
    [
        ('Magic header', 'bytes "COL2"', '4 B', 'Version identifier'),
        ('n_nodes', 'uint32', '4 B', '220,444 after subsampling'),
        ('n_frames', 'uint32', '4 B', 'Typically 100–150 frames'),
        ('n_parts', 'uint32', '4 B', '864 vehicle parts'),
        ('Position frames', 'float32[n_nodes×3×n_frames]', '~74 MB', 'XYZ per node per frame'),
        ('Scalar frames', 'uint8[n_nodes×n_frames]', '~3 MB', 'Quantised PEEQ (0–255)'),
        ('Part IDs', 'int32[n_nodes]', '~860 KB', 'Maps node → part'),
        ('Layer flags', 'uint8[n_nodes]', '~215 KB', '0=vehicle, 1=barrier'),
        ('Tire geometry', 'struct per tire', 'variable', 'Centre, axis, radius'),
    ]
)

add_heading('4.4 Version Control and Large Files', 2)
add_para(
    'Raw simulation files (d3plot*, collision_light.bin) exceed GitHub\'s 100 MB file '
    'size limit and are excluded from version control via .gitignore. '
    'An earlier incident where large files were accidentally committed to history was '
    'resolved using git-filter-repo:'
)
add_code_block([
    'pip install git-filter-repo',
    'git filter-repo --strip-blobs-bigger-than 50M --force',
])
add_para(
    'The resulting repository history contains only source code; '
    'the .git directory is approximately 636 KB.'
)

add_heading('4.5 Cloud Storage (S3)', 2)
add_para(
    'For team or production deployments, .bin files are stored in an S3-compatible '
    'bucket (AWS S3, Aliyun OSS, or MinIO). Upload files manually:'
)
add_code_block([
    '# AWS CLI example',
    'aws s3 cp collision_light.bin s3://your-bucket/simulations/collision_light.bin',
])
add_para(
    'The backend generates pre-signed URLs with a configurable expiry '
    '(default 3600 s) so browsers can download files directly without proxying '
    'through the server. The bucket should be kept private; all access goes '
    'through these time-limited URLs.'
)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — TESTING AND KNOWN ISSUES
# ═══════════════════════════════════════════════════════════════════════════
add_heading('5. Testing and Known Issues', 1)

add_heading('5.1 Manual Testing Checklist', 2)
add_para('All major features were verified through iterative manual testing:')
add_table(
    ['Feature', 'Test Method', 'Status'],
    [
        ('Point-cloud animation (100+ frames)', 'Play/pause, frame scrub, 20 fps target', '✓ Pass'),
        ('Stress colour mapping (rainbow scale)', 'Visually inspect PEEQ and Von Mises modes', '✓ Pass'),
        ('Node click → tooltip + track add', 'Click multiple nodes across parts', '✓ Pass'),
        ('Tracked point stress chart (modal)', 'Open chart, verify frame cursor syncs', '✓ Pass'),
        ('Mesh view build + animation', 'Build, play animation, verify deformation', '✓ Pass'),
        ('Mesh opacity & wireframe toggle', 'Slider + checkbox interaction', '✓ Pass'),
        ('Inspect tab part selection + highlight', 'Select group, verify highlight in 3D', '✓ Pass'),
        ('Group select / clear all buttons', 'Toggle groups, use global clear', '✓ Pass'),
        ('Tab switching (Track/Mesh/Inspect)', 'Switch tabs, verify view mode resets', '✓ Pass'),
        ('Backend simulation selector', 'Start with VITE_API_BASE_URL set, pick sim', '✓ Pass'),
        ('Local file mode (no backend)', 'Remove VITE_API_BASE_URL, reload', '✓ Pass'),
        ('Loading progress bar', 'Observe progress during 151 MB download', '✓ Pass'),
    ]
)

add_heading('5.2 Known Issues and Limitations', 2)

add_heading('Issue 1: Mesh build time on low-end hardware', 3)
add_para(
    'Building convex hulls for all 864 parts runs synchronously on the main thread '
    'and takes 2–5 seconds on a modern desktop GPU. On mobile devices or integrated '
    'graphics, this may cause the browser tab to appear frozen briefly. '
    'No loading indicator is shown during mesh build.'
)
add_para('Workaround: The "Build Mesh" button is only triggered once; subsequent tab switches re-use cached hulls.')

add_heading('Issue 2: Convex hull inaccuracy for concave parts', 3)
add_para(
    'Convex hulls are a geometric approximation. Parts with complex concave shapes '
    '(e.g., door inner panels, engine bay brackets) appear filled-in rather than '
    'following the true surface. This is a visual limitation inherent to the chosen '
    'algorithm and does not affect point-cloud accuracy.'
)

add_heading('Issue 3: Node subsampling may miss fine detail', 3)
add_para(
    'Large body panels are subsampled at a stride of 12–15 to reduce node count. '
    'Fine deformation details in these panels are smoothed out in the point cloud. '
    'Critical structural members (A/B pillars, sill) retain full node density.'
)

add_heading('Issue 4: Pre-signed URL expiry during long sessions', 3)
add_para(
    'When the backend mode is active, the pre-signed download URL expires after '
    '3600 seconds (1 hour). If a user keeps the browser tab open and attempts to '
    'reload data after expiry, the fetch will return HTTP 403. '
    'A page refresh re-triggers URL generation.'
)

add_heading('Issue 5: Single simulation file in local mode', 3)
add_para(
    'Local mode (no backend) is hard-coded to load collision_light.bin from the '
    'Vite public directory. Multiple simulation files require the full backend + S3 setup.'
)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — DEPLOYMENT AND INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════════════════
add_heading('6. Deployment and Infrastructure', 1)

add_heading('6.1 Architecture Diagram', 2)
add_code_block([
    '┌─────────────────────────────────────────┐',
    '│             User Browser                │',
    '│                                         │',
    '│  React + Three.js SPA  ←──── Vite dist  │',
    '│  (collision-viewer/dist)                │',
    '└────────────┬────────────────────────────┘',
    '             │ REST (GET only)',
    '             ▼',
    '┌─────────────────────────┐',
    '│   FastAPI Backend       │  (optional)',
    '│   uvicorn  :8000        │',
    '│   /api/simulations      │',
    '│   /api/simulations/*/   │',
    '│   signed-url            │',
    '└────────────┬────────────┘',
    '             │ boto3 / SigV4',
    '             ▼',
    '┌─────────────────────────┐',
    '│   S3-compatible Storage │',
    '│   (AWS S3 / OSS / MinIO)│',
    '│   Private bucket        │',
    '│   *.bin simulation files│',
    '└─────────────────────────┘',
])

add_heading('6.2 Static-Only Deployment (Simplest)', 2)
add_para(
    'For single-simulation demos without a backend, place collision_light.bin in '
    'the public directory, build the front-end, and serve the dist folder from any '
    'static host (GitHub Pages, Netlify, AWS S3 static website, nginx):'
)
add_code_block([
    'cd collision-viewer',
    'cp ../collision_light.bin public/',
    'npm run build',
    '# Deploy dist/ to your static host',
])
add_para('No server-side compute is required; all processing is client-side WebGL.')

add_heading('6.3 Full Stack Deployment', 2)
add_heading('6.3.1  Docker (recommended for production)', 3)
add_para('A minimal Dockerfile for the backend:')
add_code_block([
    'FROM python:3.11-slim',
    'WORKDIR /app',
    'COPY requirements.txt .',
    'RUN pip install --no-cache-dir -r requirements.txt',
    'COPY . .',
    'CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]',
])

add_heading('6.3.2  Environment Variables', 3)
add_table(
    ['Variable', 'Default', 'Description'],
    [
        ('S3_ENDPOINT_URL', '""', 'Leave blank for AWS S3; set for OSS/MinIO'),
        ('S3_ACCESS_KEY', '""', 'IAM / OSS access key'),
        ('S3_SECRET_KEY', '""', 'IAM / OSS secret key'),
        ('S3_REGION', '"us-east-1"', 'AWS region (ignored by OSS)'),
        ('S3_BUCKET', '""', 'Bucket name containing .bin files'),
        ('S3_PREFIX', '""', 'Key prefix inside the bucket, e.g. "sims/"'),
        ('SIGNED_URL_EXPIRES', '3600', 'Pre-signed URL TTL in seconds'),
        ('CORS_ORIGINS', 'localhost:5173…', 'Comma-separated allowed front-end origins'),
        ('VITE_API_BASE_URL', '(unset)', 'Front-end: backend base URL; unset = local mode'),
    ]
)

add_heading('6.3.3  HTTPS / Reverse Proxy', 3)
add_para(
    'In production, place the FastAPI server behind an nginx or Caddy reverse proxy '
    'to handle TLS termination. Ensure the CORS_ORIGINS setting includes the actual '
    'production front-end domain.'
)

add_heading('6.4 S3 Bucket Configuration', 2)
add_bullet('Block all public access — files are served only via pre-signed URLs.')
add_bullet('Enable versioning if simulation files are updated in-place.')
add_bullet('Set a lifecycle policy to expire temporary test files.')
add_bullet('For Aliyun OSS, set S3_ENDPOINT_URL to the regional endpoint, e.g. https://oss-cn-hangzhou.aliyuncs.com.')

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — FUTURE WORK
# ═══════════════════════════════════════════════════════════════════════════
add_heading('7. Future Work and Recommendations', 1)

add_heading('7.1 Performance Improvements', 2)

add_heading('7.1.1  GPU-Based Colour Mapping (GLSL Shader)', 3)
add_para(
    'Currently, the per-node colour array is updated on the CPU each frame '
    '(~220k multiplications). Moving the rainbow gradient to a vertex shader '
    'that samples from the uint8 scalar texture would eliminate this CPU cost '
    'and enable smooth 60 fps even on lower-end hardware.'
)

add_heading('7.1.2  Web Worker for Mesh Build', 3)
add_para(
    'The convex-hull build loop blocks the main thread. Offloading the geometry '
    'computation to a Web Worker (using Transferable ArrayBuffers) would keep '
    'the UI responsive during the 2–5 second build phase.'
)

add_heading('7.1.3  Lazy Frame Streaming', 3)
add_para(
    'The current COL2 format loads all frames upfront (~74 MB of positions). '
    'Splitting into per-frame chunks and streaming them on demand would reduce '
    'initial load time and enable longer simulations (currently impractical over 300+ frames).'
)

add_heading('7.2 Feature Enhancements', 2)

add_heading('7.2.1  Concave Surface Reconstruction', 3)
add_para(
    'Replace convex hulls with alpha-shape or Poisson surface reconstruction to '
    'accurately represent concave body panels. Libraries such as three-mesh-bvh '
    'or a WebAssembly port of CGAL could be explored.'
)

add_heading('7.2.2  Multi-Simulation Comparison', 3)
add_para(
    'Allow two simulation files to be loaded simultaneously with side-by-side or '
    'overlay views. This would directly support engineering use cases such as '
    'comparing design variants or barrier configurations.'
)

add_heading('7.2.3  Quantitative Reporting', 3)
add_para(
    'Add a report-generation feature that exports key metrics (peak stress per part, '
    'energy absorption curve, deformation magnitude) as a CSV or PDF. '
    'This transforms the tool from a visualiser into an analysis assistant.'
)

add_heading('7.2.4  Node Annotation and Saving', 3)
add_para(
    'Allow engineers to save named tracked-point sets to browser localStorage or '
    'the backend, so analyses are reproducible across sessions without manually '
    're-clicking nodes.'
)

add_heading('7.2.5  Part Visibility Presets', 3)
add_para(
    'Extend the existing PRESETS system with a UI to save, name, and share custom '
    'visibility configurations, making it easier to recreate standard views '
    '(e.g., "floor + sills only", "A/B pillar cross-section").'
)

add_heading('7.3 Infrastructure Improvements', 2)

add_heading('7.3.1  Automated CI/CD', 3)
add_para(
    'Add a GitHub Actions workflow to run npm run build (type-check) on every '
    'pull request and deploy to a staging environment on merge to main. '
    'This would catch TypeScript errors early and provide a shareable demo URL.'
)

add_heading('7.3.2  Authentication', 3)
add_para(
    'The current backend has no authentication. For commercial or sensitive crash '
    'data, add JWT-based auth (e.g., via FastAPI OAuth2 + a lightweight identity '
    'provider) to restrict access to authorised engineers.'
)

add_heading('7.3.3  Automated Data Extraction', 3)
add_para(
    'Integrate extract_data.py into a cloud pipeline (e.g., an AWS Lambda or '
    'container job) that automatically converts newly uploaded d3plot archives '
    'to COL2 binary files and places them in the S3 bucket, removing the manual '
    'extraction step.'
)

doc.add_page_break()

# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — VIDEO WALKTHROUGH
# ═══════════════════════════════════════════════════════════════════════════
add_heading('8. Video Walkthrough', 1)
add_para(
    'A screen-recorded walkthrough demonstrating all major features of the '
    'Collision Simulation Visualizer is available at the link below. '
    'The recording covers: data loading, point-cloud animation, node tracking, '
    'stress-history charts, mesh view construction, inspect mode part selection, '
    'and backend simulation picker.'
)

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = p.add_run('[ VIDEO WALKTHROUGH LINK ]')
run.bold = True
run.font.size = Pt(13)
run.font.color.rgb = RGBColor(0x00, 0x70, 0xC0)

doc.add_paragraph()
add_para(
    'Note: Please replace the placeholder above with the actual URL '
    '(e.g., YouTube, OneDrive, or Curtin submission portal link) before '
    'submitting the handover document.'
)

# ═══════════════════════════════════════════════════════════════════════════
# SAVE
# ═══════════════════════════════════════════════════════════════════════════
out_path = '/Users/xujiaqing/Documents/curtin/AI/visualization/Progress_Report_3_Handover.docx'
doc.save(out_path)
print(f'Saved: {out_path}')
