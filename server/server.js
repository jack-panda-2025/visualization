// Minimal server for prototype
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'bin_output_v3');
const META = path.join(OUT_DIR, 'metadata.json');

app.get('/api/metadata', (req, res) => {
  if (!fs.existsSync(META)) return res.status(404).json({error: 'metadata not found'});
  res.sendFile(META);
});

// /api/frame?source=d3plot0001&level=coarse
app.get('/api/frame', (req, res) => {
  const source = req.query.source;
  const level = req.query.level || 'coarse';
  if (!source) return res.status(400).json({error: 'missing source param'});
  const fname = `${source}_${level}.bin.gz`;
  const fpath = path.join(OUT_DIR, fname);
  if (!fs.existsSync(fpath)) return res.status(404).json({error: 'frame not found', file: fname});
  res.setHeader('Content-Type', 'application/octet-stream');
  // file is gzipped already; set encoding so client can decompress
  res.setHeader('Content-Encoding', 'gzip');
  res.sendFile(fpath);
});

// Serve frontend static (if present)
const FE = path.join(ROOT, 'frontend');
if (fs.existsSync(FE)) {
  app.use('/', express.static(FE));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
