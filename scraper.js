/* ============================================ */
/* GOOGLE SERP SCRAPER – BACKEND PARSER        */
/* ============================================ */
/*
 * Modul obsahuje dvě hlavní funkce:
 *   - parseSerp(html)   → čistá funkce (testovatelná), parsuje HTML
 *   - fetchSerp(query)  → stáhne HTML z Google a zavolá parseSerp
 *
 * Parser záměrně NEzávisí na síti ani na konkrétních CSS třídách
 * (Google je mění). Vychází ze stabilní struktury:
 *   <a href="http..."> ... <h3> ... </h3> ... </a>
 * a následného hledání popisku v sourozeneckých blocích.
 */

const cheerio = require('cheerio');
const axios = require('axios');

// ---------- KONSTANTY ----------
const GOOGLE_BASE = 'https://www.google.com/search';
const DEFAULT_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Domény/prefixy, které nejsou organickým výsledkem
const INTERNAL_PREFIXES = [
    '/search',
    '/preferences',
    '/advanced_search',
    '/url?',
    'https://www.google.',
    'https://accounts.google.',
    'https://maps.google.',
    'https://support.google.',
    'https://policies.google.',
    'https://webcache.googleusercontent.',
];

// ============================================
// VEŘEJNÁ FUNKCE: parseSerp
// ============================================
/**
 * Parsuje HTML Google SERP stránky a vrací pole organických výsledků.
 * @param {string} html – syrové HTML Google vyhledávací stránky
 * @returns {Array<{position:number,title:string,url:string,snippet:string}>}
 */
function parseSerp(html) {
    if (typeof html !== 'string' || html.trim() === '') {
        return [];
    }

    const $ = cheerio.load(html);
    const results = [];
    const seenUrls = new Set();

    // Strategie: najdi všechny <a>, které obsahují <h3> - to je typický marker
    // organického výsledku napříč generacemi Google SERP HTML.
    $('a').each((_, el) => {
        const $a = $(el);
        const $h3 = $a.find('h3').first();
        if (!$h3.length) return;

        const href = ($a.attr('href') || '').trim();
        if (!href) return;

        const url = normalizeUrl(href);
        if (!url) return;
        if (!isOrganicUrl(url)) return;
        if (seenUrls.has(url)) return;

        // Ověříme, že není uvnitř sponzorovaného/reklamního bloku
        if (isInsideAd($a)) return;

        const title = cleanText($h3.text());
        if (!title) return;

        const snippet = extractSnippet($, $a);

        seenUrls.add(url);
        results.push({
            position: results.length + 1,
            title: title,
            url: url,
            snippet: snippet,
        });
    });

    return results;
}

// ============================================
// VEŘEJNÁ FUNKCE: fetchSerp
// ============================================
/**
 * Stáhne HTML z Google pro daný dotaz a vrátí parsované organické výsledky.
 * @param {string} query – klíčové slovní spojení
 * @param {object} [options] – volitelné parametry (hl, gl, num, userAgent, timeout)
 * @returns {Promise<Array>}
 */
async function fetchSerp(query, options = {}) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
        throw new Error('Dotaz nesmí být prázdný.');
    }

    const params = {
        q: query.trim(),
        hl: options.hl || 'cs',
        gl: options.gl || 'cz',
        num: options.num || 10,
        pws: 0, // vypnutí personalizace
    };

    const headers = {
        'User-Agent': options.userAgent || DEFAULT_UA,
        'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
    };

    let response;
    try {
        response = await axios.get(GOOGLE_BASE, {
            params,
            headers,
            timeout: options.timeout || 20000,
            validateStatus: (status) => status < 500,
        });
    } catch (err) {
        throw new Error(`Nepodařilo se kontaktovat Google: ${err.message}`);
    }

    if (response.status === 429 || response.status === 503) {
        throw new Error(
            'Google dočasně zablokoval dotaz (rate-limit / CAPTCHA). Zkuste to později nebo použijte oficiální API.'
        );
    }

    if (response.status !== 200) {
        throw new Error(`Google vrátil stav ${response.status}.`);
    }

    const html = response.data;

    // Detekce CAPTCHA stránky
    if (typeof html === 'string' && /id="captcha-form"|\/sorry\//i.test(html)) {
        throw new Error('Google požaduje ověření (CAPTCHA). Zkuste to později.');
    }

        // ===== DIAGNOSTIKA – uloží odpověď z Google do souboru =====
    try {
        const fs = require('fs');
        fs.writeFileSync('debug-last-response.html', html, 'utf8');
        console.log('[DEBUG] HTML odpověď uložena do debug-last-response.html');
        console.log('[DEBUG] Velikost odpovědi:', html.length, 'znaků');
        
        // Rychlé detekce typu stránky
        if (/consent\.google|before you continue|než budete pokračovat/i.test(html)) {
            console.log('[DEBUG] ⚠️  Google vrátil CONSENT stránku (souhlas s cookies)');
        }
        if (/captcha|unusual traffic|neobvyklý provoz/i.test(html)) {
            console.log('[DEBUG] ⚠️  Google vrátil CAPTCHA stránku');
        }
        if (/<h3[^>]*>/i.test(html)) {
            const h3count = (html.match(/<h3[^>]*>/gi) || []).length;
            console.log('[DEBUG] Počet <h3> v odpovědi:', h3count);
        } else {
            console.log('[DEBUG] ⚠️  V odpovědi nejsou ŽÁDNÉ <h3> tagy!');
        }
    } catch (e) {
        console.log('[DEBUG] Chyba při ukládání:', e.message);
    }
    // ===== KONEC DIAGNOSTIKY =====

    return parseSerp(html);

}

// ============================================
// POMOCNÉ FUNKCE
// ============================================

/**
 * Normalizuje href – odstraní Google wrappery (/url?q=...), fragmenty, apod.
 */
function normalizeUrl(href) {
    if (!href) return null;

    // Relativní /url?q=... – rozbal reálnou URL
    if (href.startsWith('/url?') || href.startsWith('/url;')) {
        const match = href.match(/[?&](?:q|url)=([^&]+)/);
        if (match) {
            try {
                return decodeURIComponent(match[1]);
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    // Protokol-relative
    if (href.startsWith('//')) {
        return 'https:' + href;
    }

    // Relativní interní odkaz – nepouštíme dál
    if (href.startsWith('/')) {
        return null;
    }

    // Plná URL
    if (/^https?:\/\//i.test(href)) {
        return href;
    }

    return null;
}

/**
 * Rozhodne, zda URL patří mezi organické výsledky (ne interní Google odkaz).
 */
function isOrganicUrl(url) {
    if (!/^https?:\/\//i.test(url)) return false;

    for (const prefix of INTERNAL_PREFIXES) {
        if (url.startsWith(prefix)) return false;
    }

    return true;
}

/**
 * Detekce, zda je odkaz umístěn v reklamním/sponzorovaném bloku.
 */
function isInsideAd($a) {
    // Hledáme atributy typické pro reklamy
    const adAncestor = $a.closest(
        '[data-text-ad], [aria-label="Sponsored"], [aria-label="Sponzorováno"], .commercial-unit-desktop-top, .commercial-unit-desktop-rhs, #tads, #bottomads'
    );
    return adAncestor.length > 0;
}

/**
 * Pokusí se extrahovat krátký popisek (snippet) k výsledku.
 * Strategie: vystoupit k nejbližšímu "rodičovskému" kontejneru výsledku
 * a najít v něm textový blok, který není samotný titulek.
 */
function extractSnippet($, $a) {
    // Vyskáčeme postupně nahoru, hledáme rodiče s dostatečným textem
    let $parent = $a.parent();
    for (let i = 0; i < 6 && $parent.length; i++) {
        const parentText = cleanText($parent.text());
        const h3Text = cleanText($a.find('h3').text());

        // Odstraň titulek z celého textu, zbytek je kandidát na snippet
        if (parentText && parentText.length > h3Text.length + 30) {
            const candidate = parentText.replace(h3Text, '').trim();
            const snippet = candidate.substring(0, 320).trim();
            if (snippet.length >= 30) {
                return snippet;
            }
        }
        $parent = $parent.parent();
    }
    return '';
}

/**
 * Očistí text od bílých znaků, neviditelných znaků apod.
 */
function cleanText(text) {
    if (!text) return '';
    return String(text)
        .replace(/\s+/g, ' ')
        .replace(/\u00A0/g, ' ')
        .trim();
}

// ============================================
// EXPORT
// ============================================
module.exports = {
    parseSerp,
    fetchSerp,
    // Pomocné funkce exportujeme také – usnadní testování
    _internals: {
        normalizeUrl,
        isOrganicUrl,
        cleanText,
    },
};
