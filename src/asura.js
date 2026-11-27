// AsuraScans catalog. Every comic page sits behind a Cloudflare challenge that only
// a real tab gets through, but the /browse listing does not, and its grid's Astro
// island embeds full series records: genres, author, artist, rating and the latest
// chapters. 22 plain fetches cover the whole site.
//
// Loaded by the service worker (importScripts, for update checks) and by the
// recommendations page. Text parsing only, because the worker has no DOM.

const ASURA_ORIGIN = "https://asurascans.com";
const ASURA_PAGE_CONCURRENCY = 4;

// Astro serializes island props as [type, value] pairs, nested all the way down:
// type 1 is an array of further pairs, type 0 a plain value or an object whose
// fields are pairs again.
function astroDecode(v) {
    if (Array.isArray(v)) return v[0] === 1 ? v[1].map(astroDecode) : astroDecode(v[1]);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, astroDecode(x)]));
    return v;
}

// One pass, so "&amp;quot;" correctly becomes "&quot;" and not a quote.
const asuraUnescape = (s) =>
    s.replace(/&(quot|#39|lt|gt|amp|#\d+|#x[0-9a-f]+);/gi, (_, e) =>
        ({ quot: '"', "#39": "'", lt: "<", gt: ">", amp: "&" })[e.toLowerCase()] ??
        String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

async function asuraBrowsePage(page) {
    const res = await fetch(`${ASURA_ORIGIN}/browse?page=${page}`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
        const shield = res.headers.get("cf-mitigated") ? " (Cloudflare challenge)" : "";
        throw new Error(`${res.status}${shield} from /browse?page=${page}`);
    }
    const html = await res.text();
    const island = html.match(/<astro-island\b[^>]*BrowseFilters[^>]*>/)?.[0];
    const props = island?.match(/\bprops="([^"]*)"/)?.[1];
    if (!props) throw new Error("the browse page no longer carries series data");
    const decoded = astroDecode(JSON.parse(asuraUnescape(props)));
    return { series: decoded.initialSeries ?? [], totalPages: decoded.initialTotalPages ?? 1 };
}

// Every series on the site, as raw browse records. `onPage(done, total)` runs
// after each page. Throws if any page fails: a partial catalog would look like
// comics had disappeared.
async function asuraCatalog(onPage = () => {}) {
    const first = await asuraBrowsePage(1);
    const pages = [first];
    onPage(1, first.totalPages);
    for (let start = 2; start <= first.totalPages; start += ASURA_PAGE_CONCURRENCY) {
        const batch = [];
        for (let p = start; p < start + ASURA_PAGE_CONCURRENCY && p <= first.totalPages; p++) batch.push(asuraBrowsePage(p));
        pages.push(...(await Promise.all(batch)));
        onPage(pages.length, first.totalPages);
    }
    return pages.flatMap((p) => p.series);
}

// Highest chapter number in a record's `latest_chapters`, decimals included
// (101.5 is a real chapter here), or null when the record lists none.
function asuraLatestChapter(series) {
    const nums = (series.latest_chapters ?? []).map((c) => Number(c.number)).filter((n) => n > 0);
    return nums.length ? Math.max(...nums) : null;
}
