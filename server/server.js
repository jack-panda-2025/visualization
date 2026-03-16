const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = 3001;

app.use(cors());

app.use('/data_v2', express.static(path.join(__dirname, '..', 'vtp_output_v2')));

app.use('/bin_v2', express.static(path.join(__dirname, '..', 'bin_output_v2'), {
  setHeaders: (res) => res.setHeader('Content-Type', 'application/octet-stream')
}));

app.get('/api/metadata', (req, res) => {
  const metaPath = path.join(__dirname, '..', 'bin_output_v2', 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    return res.status(404).json({ error: 'metadata.json not found' });
  }
  res.json(JSON.parse(fs.readFileSync(metaPath)));
});

app.get('/api/health', (req, res) => {
  const binDir = path.join(__dirname, '..', 'bin_output_v2');
  const bins   = fs.existsSync(binDir)
    ? fs.readdirSync(binDir).filter(f => f.endsWith('.bin'))
    : [];
  res.json({ status: 'ok', bin_count: bins.length });
});

app.listen(PORT, () => {
  console.log('\n✓ Server: http://localhost:' + PORT);
  console.log('  Health: http://localhost:' + PORT + '/api/health');
  console.log('  Meta:   http://localhost:' + PORT + '/api/metadata\n');
});
