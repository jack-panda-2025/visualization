// Prototype server extended to serve mesh outputs
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

const ROOT = path.resolve(__dirname, '..');
const BIN_DIR = path.join(ROOT, 'bin_output_v3');
const VTP_DIR = path.join(ROOT, 'vtp_output_v3');
const BIN_META = path.join(BIN_DIR, 'metadata.json');
const VTP_META = path.join(VTP_DIR, 'metadata.json');

app.get('/api/metadata', (req, res) => {
  if (!fs.existsSync(BIN_META)) return res.status(404).json({error: 'binary metadata not found'});
  res.sendFile(BIN_META);
});

app.get('/api/mesh-metadata', (req, res) => {
  if (!fs.existsSync(VTP_META)) return res.status(404).json({error: 'mesh metadata not found'});
  res.sendFile(VTP_META);
});

// Serve gzipped binary levels (legacy endpoint)
app.get('/api/frame', (req, res) => {
  const source = req.query.source;
  const level = req.query.level || 'coarse';
  if (!source) return res.status(400).json({error: 'missing source param'});
  const fname = `${source}_${level}.bin.gz`;
  const fpath = path.join(BIN_DIR, fname);
  if (!fs.existsSync(fpath)) return res.status(404).json({error: 'frame not found', file: fname});
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Encoding', 'gzip');
  res.sendFile(fpath);
});

// Serve mesh files directly
app.get('/api/mesh', (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({error: 'missing file param'});
  const safe = path.basename(file);
  const fpath = path.join(VTP_DIR, safe);
  if (!fs.existsSync(fpath)) return res.status(404).json({error: 'mesh not found', file: safe});
  // content type for PLY
  const ext = path.extname(safe).toLowerCase();
  const ct = ext === '.ply' ? 'application/octet-stream' : 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.sendFile(fpath);
});

// Static serves
if (fs.existsSync(VTP_DIR)) {
  app.use('/meshes', express.static(VTP_DIR));
}

// Serve frontend static (if present)
const FE = path.join(ROOT, 'frontend');
if (fs.existsSync(FE)) {
  app.use('/', express.static(FE));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
