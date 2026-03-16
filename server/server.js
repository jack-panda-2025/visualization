const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3001;

app.use(cors());

// Static files
app.use('/data_v2',    express.static(path.join(__dirname, '..', 'vtp_output_v2')));
app.use('/bin_v2',     express.static(path.join(__dirname, '..', 'bin_output_v2'), {
  setHeaders: res => res.setHeader('Content-Type', 'application/octet-stream'),
}));
app.use('/pointcloud', express.static(path.join(__dirname, '..', 'pointcloud_output'), {
  setHeaders: res => res.setHeader('Content-Type', 'application/octet-stream'),
}));

// Surface metadata: merge n_points from bin, n_pts_barrier + frames from vtp
app.get('/api/metadata', (req, res) => {
  const binMeta = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'bin_output_v2', 'metadata.json')
  ));
  const vtpMeta = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'vtp_output_v2', 'metadata.json')
  ));
  res.json({
    n_frames:      vtpMeta.n_frames,
    n_points:      binMeta.n_points,       // total points per frame in binary
    n_pts_barrier: vtpMeta.n_pts_barrier,  // first N points are barrier
    frames:        vtpMeta.frames,         // accurate timestamps + vm_max
  });
});

app.get('/api/pointcloud_metadata', (req, res) => {
  const p = path.join(__dirname, '..', 'pointcloud_output', 'metadata.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'not found' });
  res.json(JSON.parse(fs.readFileSync(p)));
});

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
