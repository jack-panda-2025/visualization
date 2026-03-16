import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../output_simple');
const PORT = 3001;

const app = express();

// CORS for localhost dev
app.use(cors({
  origin: /^http:\/\/(localhost|127\.0\.0\.1):(517[0-9]|3001)$/,
  methods: ['GET', 'HEAD', 'OPTIONS'],
  allowedHeaders: ['Range', 'Content-Type'],
  exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
}));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${res.statusCode} (${elapsed}ms)`);
  });
  next();
});

// Serve static files from output/ with byte-range support
app.get('/data/:filename', (req, res) => {
  const filename = req.params.filename;

  // Basic path safety: no directory traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Invalid filename');
  }

  const filePath = path.join(DATA_DIR, filename);

  // Check file exists
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return res.status(404).send('File not found');
  }

  if (!stat.isFile()) {
    return res.status(404).send('Not a file');
  }

  const fileSize = stat.size;
  const rangeHeader = req.headers['range'];

  // Determine content-type
  let contentType = 'application/octet-stream';
  if (filename.endsWith('.json')) contentType = 'application/json';
  else if (filename.endsWith('.vtp')) contentType = 'application/octet-stream';
  else if (filename.endsWith('.bin')) contentType = 'application/octet-stream';

  if (rangeHeader) {
    // Parse Range header, e.g. "bytes=0-1023"
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Invalid Range');
      return;
    }

    const start = match[1] !== '' ? parseInt(match[1], 10) : 0;
    const end   = match[2] !== '' ? parseInt(match[2], 10) : fileSize - 1;

    if (start > end || start >= fileSize || end >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).send('Range Not Satisfiable');
      return;
    }

    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges':  'bytes',
      'Content-Length': chunkSize,
      'Content-Type':   contentType,
      'Cache-Control':  'public, max-age=3600',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
  } else {
    // Full file response
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'public, max-age=3600',
    });

    fs.createReadStream(filePath).pipe(res);
  }
});

// List available files (optional convenience endpoint)
app.get('/data', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).map(f => {
      const stat = fs.statSync(path.join(DATA_DIR, f));
      return { name: f, size: stat.size };
    });
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Crash-sim data server running on http://localhost:${PORT}`);
  console.log(`Serving files from: ${DATA_DIR}`);
});
