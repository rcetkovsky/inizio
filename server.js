/* ============================================ */
/* GOOGLE SERP SCRAPER – EXPRESS SERVER        */
/* ============================================ */
/*
 * Lehký Express server, který:
 *   - obsluhuje statické soubory (index.html, css, js)
 *   - poskytuje endpoint POST /api/search
 *   - validuje vstup, volá scraper a vrací JSON
 *
 * Spuštění:  node server.js
 * Port:      3000 (nebo přes env PORT)
 */

const express = require('express');
const path = require('path');
const { fetchSerp } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json({ limit: '10kb' }));

// Jednoduchý logger požadavků
app.use((req, _res, next) => {
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${req.method} ${req.url}`);
    next();
});

// Statické soubory – index.html, css/, js/
app.use(express.static(path.join(__dirname), {
    index: 'index.html',
    extensions: ['html'],
}));

// ============================================
// RATE LIMITING (jednoduchý in-memory)
// ============================================
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;   // 1 minuta
const RATE_LIMIT_MAX = 15;                // max 15 dotazů / minutu / IP

function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

    if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }

    entry.count += 1;
    rateLimitStore.set(ip, entry);

    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({
            error: 'Překročen limit dotazů. Zkuste to prosím za chvíli.',
        });
    }

    next();
}

// ============================================
// API: POST /api/search
// ============================================
app.post('/api/search', rateLimiter, async (req, res) => {
    const startedAt = Date.now();

    try {
        const { query } = req.body || {};

        // Validace vstupu
        if (typeof query !== 'string') {
            return res.status(400).json({ error: 'Parametr "query" musí být řetězec.' });
        }
        const trimmed = query.trim();
        if (trimmed.length < 2) {
            return res.status(400).json({ error: 'Dotaz musí mít alespoň 2 znaky.' });
        }
        if (trimmed.length > 200) {
            return res.status(400).json({ error: 'Dotaz je příliš dlouhý (max. 200 znaků).' });
        }

        // Samotné vyhledávání
        const results = await fetchSerp(trimmed, {
            hl: 'cs',
            gl: 'cz',
            num: 10,
        });

        const elapsedMs = Date.now() - startedAt;

        return res.json({
            query: trimmed,
            count: results.length,
            scrapedAt: new Date().toISOString(),
            elapsedMs,
            results,
        });
    } catch (err) {
        console.error('[API /search] Chyba:', err.message);
        const status = /rate|CAPTCHA|ověření/i.test(err.message) ? 503 : 500;
        return res.status(status).json({ error: err.message || 'Interní chyba serveru.' });
    }
});

// ============================================
// HEALTHCHECK
// ============================================
app.get('/api/health', (_req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});

// ============================================
// FALLBACK 404 (pro neznámé API routy)
// ============================================
app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Neznámý API endpoint.' });
});

// ============================================
// GLOBÁLNÍ ERROR HANDLER
// ============================================
app.use((err, _req, res, _next) => {
    console.error('[Server] Nezachycená chyba:', err);
    res.status(500).json({ error: 'Interní chyba serveru.' });
});

// ============================================
// START SERVERU
// ============================================
if (require.main === module) {
    app.listen(PORT, () => {
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('  🔍  Google SERP Scraper');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`  ✓  Server běží na:  http://localhost:${PORT}`);
        console.log(`  ✓  API endpoint:    POST /api/search`);
        console.log(`  ✓  Health check:    GET  /api/health`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
    });
}

module.exports = app;
