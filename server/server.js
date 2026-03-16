const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3001;

app.use(cors());

// 原始 vtp
app.use('/data',   express.static(path.join(__dirname, '..', 'vtp_output')));
// v2 vtp（带车壳）
app.use('/data_v2', express.static(path.join(__dirname, '..', 'vtp_output_v2')));
// v2 bin
app.use('/bin_v2', express.static(path.join(__dirname, '..', 'bin_output_v2'), {
  setHeaders: (res) => res.setHeader('Content-Type', 'application/octet-stream')
}));

app.get('/api/metadata', (req, res) => {
  const meta = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'bin_output_v2', 'metadata.json')
  ));
  // 从 vtp metadata 补充 n_pts_barrier（用于前端拆分两个 actor）
  const vtpMetaPath = path.join(__dirname, '..', 'vtp_output_v2', 'metadata.json');
  if (fs.existsSync(vtpMetaPath)) {
    const vtpMeta = JSON.parse(fs.readFileSync(vtpMetaPath));
    if (vtpMeta.n_pts_barrier) meta.n_pts_barrier = vtpMeta.n_pts_barrier;
    if (vtpMeta.n_pts_body)    meta.n_pts_body    = vtpMeta.n_pts_body;
  }
  res.json(meta);
});

// v2 pointcloud bin
app.use('/pointcloud', express.static(path.join(__dirname, '..', 'pointcloud_output'), {
  setHeaders: (res) => res.setHeader('Content-Type', 'application/octet-stream')
}));

app.get('/api/pointcloud_metadata', (req, res) => {
  const p = path.join(__dirname, '..', 'pointcloud_output', 'metadata.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not generated yet' });
  res.json(JSON.parse(fs.readFileSync(p)));
});

app.get('/api/health', (req, res) => {
  const bins = fs.readdirSync(path.join(__dirname, '..', 'bin_output_v2')).filter(f => f.endsWith('.bin'));
  res.json({ status: 'ok', bin_count: bins.length });
});

app.listen(PORT, () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
});
