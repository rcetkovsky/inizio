/* ============================================ */
/* GOOGLE SERP SCRAPER – UNIT TESTY            */
/* ============================================ */
/*
 * Testovací sada pro scraper.js.
 * Používá vestavěný modul node:test (Node.js 18+), takže nevyžaduje
 * žádnou externí testovací knihovnu (Jest/Mocha).
 *
 * Spuštění:  npm test         (skript v package.json)
 *            node --test scraper.test.js
 *
 * Testy jsou rozděleny do několika bloků (describe):
 *   1. parseSerp – základní kontrakt
 *   2. parseSerp – kvalita dat (titulek, URL, pořadí, duplicity)
 *   3. parseSerp – filtrace reklam a interních odkazů
 *   4. parseSerp – odolnost vůči nevalidnímu vstupu
 *   5. _internals – pomocné funkce (normalizeUrl, isOrganicUrl, cleanText)
 *   6. fetchSerp – validace vstupu
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSerp, fetchSerp, _internals } = require('./scraper');
const { normalizeUrl, isOrganicUrl, cleanText } = _internals;

// ============================================
// NAČTENÍ FIXTURE HTML
// ============================================
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-serp.html');
const fixtureHtml = fs.readFileSync(FIXTURE_PATH, 'utf8');

// ============================================
// 1. ZÁKLADNÍ KONTRAKT parseSerp
// ============================================
describe('parseSerp – základní kontrakt', () => {

    test('vrací pole', () => {
        const result = parseSerp(fixtureHtml);
        assert.ok(Array.isArray(result), 'výsledek musí být pole');
    });

    test('parsuje minimálně jeden výsledek z fixture', () => {
        const result = parseSerp(fixtureHtml);
        assert.ok(result.length >= 1, `očekávám >=1 výsledek, dostal jsem ${result.length}`);
    });

    test('každý výsledek má požadované klíče (position, title, url, snippet)', () => {
        const result = parseSerp(fixtureHtml);
        for (const item of result) {
            assert.ok('position' in item, 'chybí klíč position');
            assert.ok('title' in item, 'chybí klíč title');
            assert.ok('url' in item, 'chybí klíč url');
            assert.ok('snippet' in item, 'chybí klíč snippet');
        }
    });

    test('datové typy kláves jsou správné', () => {
        const result = parseSerp(fixtureHtml);
        for (const item of result) {
            assert.equal(typeof item.position, 'number', 'position musí být number');
            assert.equal(typeof item.title, 'string', 'title musí být string');
            assert.equal(typeof item.url, 'string', 'url musí být string');
            assert.equal(typeof item.snippet, 'string', 'snippet musí být string');
        }
    });
});

// ============================================
// 2. KVALITA DAT
// ============================================
describe('parseSerp – kvalita dat', () => {

    test('titulky nejsou prázdné', () => {
        const result = parseSerp(fixtureHtml);
        for (const item of result) {
            assert.ok(item.title.trim().length > 0, `prázdný titulek na pozici ${item.position}`);
        }
    });

    test('URL jsou validní absolutní http/https adresy', () => {
        const result = parseSerp(fixtureHtml);
        for (const item of result) {
            assert.match(
                item.url,
                /^https?:\/\/[^\s]+$/,
                `nevalidní URL: ${item.url}`
            );
        }
    });

    test('pořadí (position) je 1..N bez mezer', () => {
        const result = parseSerp(fixtureHtml);
        result.forEach((item, idx) => {
            assert.equal(item.position, idx + 1, `očekávaná pozice ${idx + 1}, dostal ${item.position}`);
        });
    });

    test('URL jsou unikátní (žádné duplicity)', () => {
        const result = parseSerp(fixtureHtml);
        const urls = result.map(r => r.url);
        const uniqueUrls = new Set(urls);
        assert.equal(
            uniqueUrls.size,
            urls.length,
            'nalezeny duplicitní URL v organických výsledcích'
        );
    });

    test('titulky neobsahují přebytečné bílé znaky', () => {
        const result = parseSerp(fixtureHtml);
        for (const item of result) {
            assert.equal(item.title, item.title.trim(), 'titulek má okrajové mezery');
            assert.doesNotMatch(item.title, /\s{2,}/, 'titulek obsahuje vícenásobné mezery');
        }
    });
});

// ============================================
// 3. FILTRACE REKLAM A INTERNÍCH ODKAZŮ
// ============================================
describe('parseSerp – filtrace reklam a interních odkazů', () => {

    test('žádný výsledek nepochází z reklamního bloku', () => {
        const result = parseSerp(fixtureHtml);
        // Fixture obsahuje reklamu s URL https://ad.example.com – nesmí být ve výsledku
        const hasAd = result.some(r => r.url.includes('ad.example.com'));
        assert.equal(hasAd, false, 'reklama se dostala mezi organické výsledky');
    });

    test('žádná URL nevede na interní Google stránku', () => {
        const result = parseSerp(fixtureHtml);
        const internalPrefixes = [
            'https://www.google.',
            'https://accounts.google.',
            'https://maps.google.',
            'https://support.google.',
            'https://policies.google.',
            'https://webcache.googleusercontent.',
        ];
        for (const item of result) {
            for (const prefix of internalPrefixes) {
                assert.ok(
                    !item.url.startsWith(prefix),
                    `interní Google URL nalezena: ${item.url}`
                );
            }
        }
    });

    test('fixture s čistě reklamním obsahem vrátí prázdné pole', () => {
        const adOnlyHtml = `
            <html><body>
                <div id="tads">
                    <div data-text-ad="1">
                        <a href="https://reklama.example.com">
                            <h3>Reklamní titulek</h3>
                        </a>
                        <span>Reklamní popisek</span>
                    </div>
                </div>
            </body></html>
        `;
        const result = parseSerp(adOnlyHtml);
        assert.equal(result.length, 0, 'reklamy nesmí být považovány za organické výsledky');
    });
});

// ============================================
// 4. ODOLNOST VŮČI NEVALIDNÍMU VSTUPU
// ============================================
describe('parseSerp – odolnost vůči nevalidnímu vstupu', () => {

    test('prázdný string vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(''), []);
    });

    test('null vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(null), []);
    });

    test('undefined vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(undefined), []);
    });

    test('číselný vstup vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(12345), []);
    });

    test('HTML bez odkazů vrátí prázdné pole', () => {
        const html = '<html><body><p>Žádné výsledky.</p></body></html>';
        assert.deepEqual(parseSerp(html), []);
    });

    test('poškozené HTML nevyhodí výjimku', () => {
        const brokenHtml = '<html><body><a href="<<<<<>>>><h3>Nezavřený';
        assert.doesNotThrow(() => parseSerp(brokenHtml));
    });
});

// ============================================
// 5. POMOCNÉ FUNKCE – _internals
// ============================================
describe('_internals.normalizeUrl', () => {

    test('rozbalí Google wrapper /url?q=...', () => {
        const input = '/url?q=https%3A%2F%2Fexample.com%2Fclanek&sa=U';
        assert.equal(normalizeUrl(input), 'https://example.com/clanek');
    });

    test('ponechá plnou https URL beze změny', () => {
        assert.equal(
            normalizeUrl('https://example.com/foo?bar=1'),
            'https://example.com/foo?bar=1'
        );
    });

    test('doplní protokol k //cdn.example.com', () => {
        assert.equal(normalizeUrl('//cdn.example.com/a.js'), 'https://cdn.example.com/a.js');
    });

    test('odmítne relativní interní odkaz', () => {
        assert.equal(normalizeUrl('/settings'), null);
    });

    test('prázdný / null vstup vrátí null', () => {
        assert.equal(normalizeUrl(''), null);
        assert.equal(normalizeUrl(null), null);
    });
});

describe('_internals.isOrganicUrl', () => {

    test('běžná externí URL je organická', () => {
        assert.equal(isOrganicUrl('https://example.com/clanek'), true);
    });

    test('google.com URL není organická', () => {
        assert.equal(isOrganicUrl('https://www.google.com/search?q=test'), false);
    });

    test('accounts.google.com URL není organická', () => {
        assert.equal(isOrganicUrl('https://accounts.google.com/login'), false);
    });

    test('webcache není organická', () => {
        assert.equal(
            isOrganicUrl('https://webcache.googleusercontent.com/search?q=foo'),
            false
        );
    });

    test('nevalidní řetězec není organický', () => {
        assert.equal(isOrganicUrl('not-a-url'), false);
    });
});

describe('_internals.cleanText', () => {

    test('odstraní vícenásobné mezery', () => {
        assert.equal(cleanText('  foo    bar   baz  '), 'foo bar baz');
    });

    test('převede nedělitelnou mezeru na normální', () => {
        assert.equal(cleanText('foo\u00A0bar'), 'foo bar');
    });

    test('prázdný vstup vrátí prázdný string', () => {
        assert.equal(cleanText(''), '');
        assert.equal(cleanText(null), '');
        assert.equal(cleanText(undefined), '');
    });
});

// ============================================
// 6. fetchSerp – validace vstupu (bez síťového volání)
// ============================================
describe('fetchSerp – validace vstupu', () => {

    test('prázdný dotaz vyhodí chybu', async () => {
        await assert.rejects(
            () => fetchSerp(''),
            /prázdný/i
        );
    });

    test('null dotaz vyhodí chybu', async () => {
        await assert.rejects(
            () => fetchSerp(null),
            /prázdný/i
        );
    });

    test('dotaz typu number vyhodí chybu', async () => {
        await assert.rejects(
            () => fetchSerp(42),
            /prázdný/i
        );
    });

    test('jen whitespace vyhodí chybu', async () => {
        await assert.rejects(
            () => fetchSerp('    '),
            /prázdný/i
        );
    });
});

// ============================================
// 7. INTEGRAČNÍ TEST – ukázkový výstup z fixture
// ============================================
describe('parseSerp – integrační ověření fixture', () => {

    test('očekávané domény jsou obsažené ve výsledcích', () => {
        const result = parseSerp(fixtureHtml);
        const hosts = result.map(r => {
            try { return new URL(r.url).host; } catch (e) { return ''; }
        });

        // Fixture obsahuje tyto organické výsledky
        assert.ok(hosts.includes('cs.wikipedia.org'), 'chybí cs.wikipedia.org');
        assert.ok(hosts.includes('www.example.com'), 'chybí www.example.com');
        assert.ok(hosts.includes('blog.example.org'), 'chybí blog.example.org');
    });

    test('první výsledek z fixture má očekávaný titulek', () => {
        const result = parseSerp(fixtureHtml);
        assert.ok(result.length > 0);
        assert.match(result[0].title, /Wikipedie|Wikipedia/i);
    });
});
