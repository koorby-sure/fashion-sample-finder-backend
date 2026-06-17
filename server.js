import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_BASE_URL = (
  process.env.PUBLIC_BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://localhost:${PORT}`
).replace(/\/$/, '');
const DEMO_MODE = String(process.env.DEMO_MODE || 'false').toLowerCase() === 'true';
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '*')
  .split(',')
  .map(value => value.trim().replace(/\/$/, ''))
  .filter(Boolean);

const uploadsDir = path.join(__dirname, 'public', 'uploads');
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
if (!existsSync(screenshotsDir)) mkdirSync(screenshotsDir, { recursive: true });

// CORS for GitHub Pages frontend.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const normalizedOrigin = origin ? origin.replace(/\/$/, '') : '';
  const allowAny = ALLOWED_ORIGINS.includes('*');
  const isAllowed = allowAny || (normalizedOrigin && ALLOWED_ORIGINS.includes(normalizedOrigin));

  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', allowAny ? '*' : origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use('/screenshots', express.static(screenshotsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
      return;
    }
    cb(null, true);
  }
});

function normalizeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid protocol');
    return parsed.toString();
  } catch {
    throw new Error('Invalid URL');
  }
}

function extractDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function uniqByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

function mapSerpApiResults(data) {
  const buckets = [
    ...(data?.exact_matches || []),
    ...(data?.visual_matches || []),
    ...(data?.products || []),
    ...(data?.shopping_results || [])
  ];

  const items = buckets.map((item, index) => {
    const url = item.link || item.source || item.product_link || item.serpapi_product_api || '';
    const score = item.position ? Math.max(40, 100 - item.position * 4) : Math.max(40, 95 - index * 5);
    return {
      id: `${index + 1}`,
      title: item.title || item.name || item.source || 'Visual match',
      url,
      domain: extractDomain(url),
      thumbnail: item.thumbnail || item.image || item.source_icon || '',
      source: item.source || item.domain || extractDomain(url),
      price: item.price || item.extracted_price || '',
      score,
      confidence: score
    };
  }).filter(item => item.url && /^https?:\/\//.test(item.url));

  return uniqByUrl(items).slice(0, 12);
}

function firstUploadedImage(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length) return req.files[0];
  return null;
}

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fashion Finder Backend</title></head>
<body style="font-family:Arial,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.5">
<h1>Fashion Sample Finder Backend is running</h1>
<p>Health check: <a href="/health">/health</a></p>
<p>Use this base URL as Backend URL in your GitHub Pages frontend.</p>
</body></html>`);
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, mode: DEMO_MODE || !process.env.SERPAPI_API_KEY ? 'demo' : 'live', publicBaseUrl: PUBLIC_BASE_URL, time: new Date().toISOString() });
});

// Frontend sends field name "image". We also accept any image file for compatibility.
app.post('/api/search', upload.any(), async (req, res) => {
  try {
    const brand = String(req.body.brand || '').trim();
    const imageKind = String(req.body.imageKind || 'sample').trim();
    const uploadedImage = firstUploadedImage(req);

    if (!uploadedImage) {
      res.status(400).json({ error: 'Upload a sample image first.' });
      return;
    }

    const imageUrl = `${PUBLIC_BASE_URL}/uploads/${encodeURIComponent(uploadedImage.filename)}`;

    if (DEMO_MODE || !process.env.SERPAPI_API_KEY) {
      res.json({
        mode: 'demo',
        imageUrl,
        note: 'Demo mode: add SERPAPI_API_KEY for real visual search.',
        results: [
          {
            id: 'demo-1',
            title: brand ? `${brand} possible product page` : 'Possible product page',
            url: 'https://www.zara.com/',
            domain: 'zara.com',
            thumbnail: imageUrl,
            source: 'Demo result',
            score: 76,
            confidence: 76
          },
          {
            id: 'demo-2',
            title: brand ? `${brand} visual match` : 'Visual match',
            url: 'https://www2.hm.com/',
            domain: 'hm.com',
            thumbnail: imageUrl,
            source: 'Demo result',
            score: 68,
            confidence: 68
          }
        ]
      });
      return;
    }

    const params = new URLSearchParams({
      engine: 'google_lens',
      url: imageUrl,
      type: 'all',
      auto_crop: 'true',
      safe: 'active',
      hl: 'en',
      country: 'ae',
      api_key: process.env.SERPAPI_API_KEY,
      output: 'json'
    });

    if (brand) params.set('q', `${brand} ${imageKind} girls clothing`);

    const serpResponse = await fetch(`https://serpapi.com/search?${params.toString()}`);
    const data = await serpResponse.json();

    if (!serpResponse.ok || data?.error) {
      res.status(502).json({ error: data?.error || 'Visual search API failed.', imageUrl });
      return;
    }

    const results = mapSerpApiResults(data);
    res.json({ mode: 'live', imageUrl, results });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Search failed.' });
  }
});

app.post('/api/screenshot', async (req, res) => {
  let browser;
  try {
    const url = normalizeUrl(req.body.url);
    const modeRaw = String(req.body.mode || 'viewport');
    const mode = modeRaw === 'customArea' ? 'clip' : modeRaw;

    const viewportWidth = Number(req.body.viewport?.width || req.body.viewportWidth || 1440);
    const viewportHeight = Number(req.body.viewport?.height || req.body.viewportHeight || 1200);
    const scrollY = Number(req.body.scrollY || 0);
    const waitMs = Math.min(Number(req.body.waitMs || 1800), 8000);

    const safeViewportWidth = Math.min(Math.max(viewportWidth, 360), 2200);
    const safeViewportHeight = Math.min(Math.max(viewportHeight, 480), 2400);
    const fileName = `screenshot-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
    const filePath = path.join(screenshotsDir, fileName);

    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage({
      viewport: { width: safeViewportWidth, height: safeViewportHeight },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36'
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(waitMs);

    const popupButtons = [
      'button:has-text("Accept")',
      'button:has-text("Accept all")',
      'button:has-text("I agree")',
      'button:has-text("OK")',
      'button:has-text("Allow all")',
      'button:has-text("Agree")'
    ];

    for (const selector of popupButtons) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 700 })) await btn.click({ timeout: 700 });
      } catch {}
    }

    if (scrollY > 0) await page.evaluate(y => window.scrollTo(0, y), scrollY);
    await page.waitForTimeout(500);

    if (mode === 'fullPage') {
      await page.screenshot({ path: filePath, fullPage: true });
    } else if (mode === 'clip') {
      const clip = {
        x: Math.max(Number(req.body.clip?.x || req.body.clipX || 0), 0),
        y: Math.max(Number(req.body.clip?.y || req.body.clipY || 0), 0),
        width: Math.min(Math.max(Number(req.body.clip?.width || req.body.clipWidth || 900), 100), safeViewportWidth),
        height: Math.min(Math.max(Number(req.body.clip?.height || req.body.clipHeight || 900), 100), safeViewportHeight)
      };
      await page.screenshot({ path: filePath, clip });
    } else {
      await page.screenshot({ path: filePath, fullPage: false });
    }

    await browser.close();
    browser = null;

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.sendFile(filePath);

    // Best-effort cleanup after response starts.
    setTimeout(() => fs.unlink(filePath).catch(() => {}), 60_000);
  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    res.status(500).json({ error: error.message || 'Screenshot failed.' });
  }
});

app.listen(PORT, HOST, () => {
  console.log(`Fashion Sample Finder backend running on ${HOST}:${PORT}`);
  console.log(`Public base URL: ${PUBLIC_BASE_URL}`);
});
