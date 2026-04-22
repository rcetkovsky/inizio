/* ============================================ */
/* UNIT TESTY – parseSerp (Serper.dev)         */
/* ============================================ */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSerp, fetchSerp, _internals } = require('./scraper');

const FIXTURE = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'sample-serper.json'), 'utf8')
);

describe('parseSerp – základní kontrakt', () => {
    test('vrací pole', () => {
        assert.ok(Array.isArray(parseSerp(FIXTURE)));
    });

    test('parsuje všechny organické výsledky z fixture', () => {
        const result = parseSerp(FIXTURE);
        assert.equal(result.length, FIXTURE.organic.length);
    });

    test('každý výsledek má požadované klíče', () => {
        const result = parseSerp(FIXTURE);
        for (const item of result) {
            assert.ok('position' in item);
            assert.ok('title' in item);
            assert.ok('url' in item);
            assert.ok('snippet' in item);
        }
    });

    test('datové typy odpovídají kontraktu', () => {
        const result = parseSerp(FIXTURE);
        for (const item of result) {
            assert.equal(typeof item.position, 'number');
            assert.equal(typeof item.title, 'string');
            assert.equal(typeof item.url, 'string');
            assert.equal(typeof item.snippet, 'string');
        }
    });
});

describe('parseSerp – kvalita dat', () => {
    test('titulky nejsou prázdné', () => {
        for (const item of parseSerp(FIXTURE)) {
            assert.ok(item.title.trim().length > 0);
        }
    });

    test('URL jsou validní http/https adresy', () => {
        for (const item of parseSerp(FIXTURE)) {
            assert.match(item.url, /^https?:\/\/[^\s]+$/);
        }
    });

    test('pozice jsou 1..N bez mezer', () => {
        const result = parseSerp(FIXTURE);
        result.forEach((item, idx) => {
            assert.equal(item.position, idx + 1);
        });
    });

    test('URL jsou unikátní', () => {
        const urls = parseSerp(FIXTURE).map((r) => r.url);
        assert.equal(new Set(urls).size, urls.length);
    });

    test('titulky neobsahují okrajové mezery', () => {
        for (const item of parseSerp(FIXTURE)) {
            assert.equal(item.title, item.title.trim());
        }
    });
});

describe('parseSerp – odolnost vůči nevalidnímu vstupu', () => {
    test('null vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(null), []);
    });
    test('undefined vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp(undefined), []);
    });
    test('prázdný objekt vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp({}), []);
    });
    test('objekt bez organic klíče vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp({ other: 'data' }), []);
    });
    test('organic není pole – vrátí prázdné pole', () => {
        assert.deepEqual(parseSerp({ organic: 'invalid' }), []);
    });
    test('položka bez url je ignorována', () => {
        const result = parseSerp({
            organic: [
                { title: 'A', link: 'https://example.com', snippet: 'x' },
                { title: 'B', snippet: 'y' },
            ],
        });
        assert.equal(result.length, 1);
    });
    test('duplicitní URL jsou odfiltrovány', () => {
        const result = parseSerp({
            organic: [
                { title: 'A', link: 'https://example.com/x', snippet: 's1' },
                { title: 'A2', link: 'https://example.com/x', snippet: 's2' },
                { title: 'B', link: 'https://example.com/y', snippet: 's3' },
            ],
        });
        assert.equal(result.length, 2);
    });
});

describe('fetchSerp – validace vstupu', () => {
    test('prázdný dotaz vyhodí chybu', async () => {
        await assert.rejects(() => fetchSerp(''), /prázdný/i);
    });
    test('null dotaz vyhodí chybu', async () => {
        await assert.rejects(() => fetchSerp(null), /prázdný/i);
    });
    test('chybějící API klíč vyhodí chybu', async () => {
        const original = process.env.SERPER_API_KEY;
        delete process.env.SERPER_API_KEY;
        await assert.rejects(() => fetchSerp('test'), /API klíč/i);
        if (original) process.env.SERPER_API_KEY = original;
    });
});

describe('_internals.cleanText', () => {
    const { cleanText } = _internals;
    test('odstraní vícenásobné mezery', () => {
        assert.equal(cleanText('  a    b   c  '), 'a b c');
    });
    test('převede nedělitelnou mezeru', () => {
        assert.equal(cleanText('a\u00A0b'), 'a b');
    });
    test('prázdný vstup → prázdný string', () => {
        assert.equal(cleanText(''), '');
        assert.equal(cleanText(null), '');
        assert.equal(cleanText(undefined), '');
    });
});
