/* ============================================ */
/* GOOGLE SERP SCRAPER – přes Serper.dev API   */
/* ============================================ */

const axios = require('axios');

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

/**
 * Parsuje odpověď ze Serper.dev API a vrací pole organických výsledků.
 * Čistá funkce – testovatelná bez síťového volání.
 */
function parseSerp(apiResponse) {
    if (!apiResponse || typeof apiResponse !== 'object') return [];
    const organic = Array.isArray(apiResponse.organic) ? apiResponse.organic : [];

    const seen = new Set();
    const results = [];

    organic.forEach((item) => {
        if (!item || typeof item !== 'object') return;

        const title = cleanText(item.title);
        const url = typeof item.link === 'string' ? item.link.trim() : '';
        const snippet = cleanText(item.snippet);

        if (!title || !url) return;
        if (!/^https?:\/\//i.test(url)) return;
        if (seen.has(url)) return;

        seen.add(url);
        results.push({
            position: results.length + 1,
            title: title,
            url: url,
            snippet: snippet,
        });
    });

    return results;
}

/**
 * Zavolá Serper.dev API a vrátí parsované organické výsledky z Google.
 */
async function fetchSerp(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        throw new Error('Dotaz nesmí být prázdný.');
    }

    const apiKey = options.apiKey || process.env.SERPER_API_KEY;
    if (!apiKey) {
        throw new Error('Chybí API klíč (SERPER_API_KEY). Nastavte ho v Environment Variables na Renderu.');
    }

    let response;
    try {
        response = await axios.post(
            SERPER_ENDPOINT,
            {
                q: query.trim(),
                gl: options.gl || 'cz',
                hl: options.hl || 'cs',
                num: options.num || 10,
            },
            {
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json',
                },
                timeout: options.timeout || 20000,
            }
        );
    } catch (err) {
        if (err.response && err.response.status === 401) {
            throw new Error('Neplatný API klíč pro Serper.dev.');
        }
        if (err.response && err.response.status === 429) {
            throw new Error('Překročen limit Serper.dev API. Zkuste to později.');
        }
        throw new Error(`Chyba při volání API: ${err.message}`);
    }

    return parseSerp(response.data);
}

function cleanText(text) {
    if (!text) return '';
    return String(text).replace(/\s+/g, ' ').replace(/\u00A0/g, ' ').trim();
}

module.exports = {
    parseSerp,
    fetchSerp,
    _internals: { cleanText },
};
