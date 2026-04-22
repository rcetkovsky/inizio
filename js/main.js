/* ============================================ */
/* GOOGLE SERP SCRAPER – FRONTEND LOGIKA       */
/* ============================================ */

(function () {
    'use strict';

    // ---------- KONSTANTY ----------
    const API_ENDPOINT = '/api/search';
    const REQUEST_TIMEOUT_MS = 25000;

    // ---------- DOM ODKAZY ----------
    const form = document.getElementById('search-form');
    const input = document.getElementById('query');
    const searchBtn = document.getElementById('search-btn');
    const statusEl = document.getElementById('status');
    const resultsSection = document.getElementById('results-section');
    const resultsBody = document.getElementById('results-body');
    const exportPanel = document.getElementById('export-panel');
    const resultCountEl = document.getElementById('result-count');
    const resultQueryEl = document.getElementById('result-query');
    const btnJson = document.getElementById('export-json');
    const btnCsv = document.getElementById('export-csv');
    const btnNdjson = document.getElementById('export-ndjson');

    // ---------- STAV APLIKACE ----------
    const state = {
        lastQuery: '',
        lastResults: [],
    };

    // ============================================
    // INICIALIZACE
    // ============================================
    function init() {
        form.addEventListener('submit', handleSubmit);
        btnJson.addEventListener('click', () => exportResults('json'));
        btnCsv.addEventListener('click', () => exportResults('csv'));
        btnNdjson.addEventListener('click', () => exportResults('ndjson'));
    }

    // ============================================
    // HLAVNÍ HANDLER FORMULÁŘE
    // ============================================
    async function handleSubmit(event) {
        event.preventDefault();

        const query = input.value.trim();
        if (query.length < 2) {
            setStatus('Zadejte alespoň 2 znaky.', 'error');
            input.focus();
            return;
        }

        setLoading(true);
        setStatus('Vyhledávám na Google…', 'info');
        hideResults();

        try {
            const results = await fetchResults(query);

            if (!Array.isArray(results) || results.length === 0) {
                setStatus('Pro zadaný dotaz nebyly nalezeny žádné výsledky.', 'error');
                return;
            }

            state.lastQuery = query;
            state.lastResults = results;
            renderResults(results, query);
            setStatus(`Načteno ${results.length} organických výsledků.`, 'success');
        } catch (error) {
            console.error('[SERP] Chyba při vyhledávání:', error);
            setStatus(`Chyba: ${error.message || 'vyhledávání se nezdařilo'}`, 'error');
        } finally {
            setLoading(false);
        }
    }

    // ============================================
    // API VOLÁNÍ
    // ============================================
    async function fetchResults(query) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query }),
                signal: controller.signal,
            });

            if (!response.ok) {
                const errText = await response.text().catch(() => '');
                throw new Error(
                    `Server vrátil ${response.status} ${response.statusText}. ${errText}`
                );
            }

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            return data.results || [];
        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error('Vypršel časový limit požadavku.');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    // ============================================
    // RENDER VÝSLEDKŮ
    // ============================================
    function renderResults(results, query) {
        resultsBody.innerHTML = '';

        const fragment = document.createDocumentFragment();

        results.forEach((item) => {
            const tr = document.createElement('tr');

            const tdPos = document.createElement('td');
            tdPos.className = 'col-position';
            tdPos.textContent = String(item.position);

            const tdTitle = document.createElement('td');
            tdTitle.className = 'col-title';
            const titleLink = document.createElement('a');
            titleLink.href = item.url;
            titleLink.target = '_blank';
            titleLink.rel = 'noopener noreferrer';
            titleLink.textContent = item.title || '(bez titulku)';
            tdTitle.appendChild(titleLink);

            const tdSnippet = document.createElement('td');
            tdSnippet.className = 'col-snippet';
            tdSnippet.textContent = item.snippet || '—';

            const tdUrl = document.createElement('td');
            tdUrl.className = 'col-url';
            const urlLink = document.createElement('a');
            urlLink.href = item.url;
            urlLink.target = '_blank';
            urlLink.rel = 'noopener noreferrer';
            urlLink.textContent = shortenUrl(item.url);
            tdUrl.appendChild(urlLink);

            tr.appendChild(tdPos);
            tr.appendChild(tdTitle);
            tr.appendChild(tdSnippet);
            tr.appendChild(tdUrl);

            fragment.appendChild(tr);
        });

        resultsBody.appendChild(fragment);

        resultCountEl.textContent = String(results.length);
        resultQueryEl.textContent = query;

        exportPanel.hidden = false;
        resultsSection.hidden = false;
    }

    function hideResults() {
        resultsSection.hidden = true;
        exportPanel.hidden = true;
        resultsBody.innerHTML = '';
    }

    // ============================================
    // EXPORT
    // ============================================
    function exportResults(format) {
        if (!state.lastResults.length) return;

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const slug = slugify(state.lastQuery) || 'serp';
        const baseName = `serp-${slug}-${timestamp}`;

        switch (format) {
            case 'json':
                downloadFile(
                    buildJson(state.lastResults, state.lastQuery),
                    `${baseName}.json`,
                    'application/json;charset=utf-8'
                );
                break;
            case 'csv':
                downloadFile(
                    buildCsv(state.lastResults),
                    `${baseName}.csv`,
                    'text/csv;charset=utf-8'
                );
                break;
            case 'ndjson':
                downloadFile(
                    buildNdjson(state.lastResults),
                    `${baseName}.ndjson`,
                    'application/x-ndjson;charset=utf-8'
                );
                break;
        }
    }

    function buildJson(results, query) {
        const payload = {
            query: query,
            scrapedAt: new Date().toISOString(),
            count: results.length,
            results: results,
        };
        return JSON.stringify(payload, null, 2);
    }

    function buildCsv(results) {
        const header = ['position', 'title', 'url', 'snippet'];
        const rows = [header.join(',')];

        results.forEach((r) => {
            rows.push(
                [
                    csvEscape(r.position),
                    csvEscape(r.title),
                    csvEscape(r.url),
                    csvEscape(r.snippet),
                ].join(',')
            );
        });

        // BOM pro správné zobrazení diakritiky v Excelu
        return '\uFEFF' + rows.join('\r\n');
    }

    function buildNdjson(results) {
        return results.map((r) => JSON.stringify(r)).join('\n');
    }

    function csvEscape(value) {
        if (value === null || value === undefined) return '';
        const str = String(value);
        if (/[",\r\n;]/.test(str)) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    }

    function downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // ============================================
    // POMOCNÉ FUNKCE
    // ============================================
    function setLoading(isLoading) {
        searchBtn.disabled = isLoading;
        input.disabled = isLoading;
        searchBtn.classList.toggle('is-loading', isLoading);
    }

    function setStatus(message, type) {
        statusEl.textContent = message || '';
        statusEl.className = 'status';
        if (message && type) {
            statusEl.classList.add('is-' + type);
        }
    }

    function shortenUrl(url) {
        try {
            const u = new URL(url);
            const path = (u.pathname + u.search).replace(/\/$/, '');
            const short = u.host + (path.length > 35 ? path.slice(0, 35) + '…' : path);
            return short;
        } catch (e) {
            return url;
        }
    }

    function slugify(text) {
        return String(text)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 50);
    }

    // ============================================
    // START
    // ============================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
