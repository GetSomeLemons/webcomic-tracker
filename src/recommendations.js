// Recommendations. Builds a taste profile from the user's own ratings plus the
// genres, author and artist each site lists for the saved comics, then scores the
// sites' catalogs against it.
//
// Runs in this page, not the service worker: the work only matters while someone
// is looking at the result.
//
// Neither site needs a tab. AsuraScans comes from its browse catalog (asura.js),
// Qi Manga from its public JSON API.

const QI_ORIGIN = "https://qimanga.com";
const QI_API = "https://api.qimanga.com/api/v1";

const FETCH_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
// Qi's series list names no genres or people. Qi candidates therefore come from
// the listings of the profile's strongest genres, and only the best of them get
// the detail call that names the author and artist.
const QI_GENRES = 4;
const QI_PAGES_PER_GENRE = 2; // 100 series per page, most popular first
const QI_DETAIL_TOP = 20;
const QI_DETAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SHOWN = 30;

const asura = siteFor("asurascans.com");
const qi = siteFor("qimanga.com");
const SITE_NAMES = { [asura.host]: "AsuraScans", [qi.host]: "Qi Manga" };

// ── Fetching ───────────────────────────────────────────────────────────────

async function getText(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return res.text();
}

const getJson = async (url) => JSON.parse(await getText(url));

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

// ── AsuraScans ─────────────────────────────────────────────────────────────

async function asuraEntries(say) {
    const series = await asuraCatalog((done, total) => say(`Reading the AsuraScans catalog, page ${done}/${total}…`));
    return series.map((s) => ({
        id: comicId(asura, s.slug),
        site: asura.host,
        title: s.title,
        url: ASURA_ORIGIN + s.public_url,
        cover: s.cover,
        genres: (s.genres ?? []).map(({ slug, name }) => ({ slug, name })),
        people: [s.author, s.artist],
        rating: s.rating ? s.rating / 10 : null,
        ratingLabel: s.rating ? `${s.rating.toFixed(1)}/10` : null,
        complete: true,
    }));
}

// ── Qi Manga ───────────────────────────────────────────────────────────────

function qiEntry(s) {
    return {
        id: comicId(qi, s.slug),
        slug: s.slug,
        site: qi.host,
        title: s.title,
        url: `${QI_ORIGIN}/series/${s.slug}`,
        cover: s.cover,
        genres: [], // membership of the scanned listings until the detail call
        people: [],
        rating: s.avgRating ? s.avgRating / 5 : null,
        ratingLabel: s.avgRating ? `${s.avgRating.toFixed(1)}/5` : null,
        complete: false,
    };
}

// Cached for a week in storage: without it, every saved Qi comic costs a request
// on every build.
async function qiDetail(slug, cache) {
    const hit = cache[slug];
    if (hit && Date.now() - hit.at < QI_DETAIL_TTL_MS) return hit;
    const d = await getJson(`${QI_API}/series/${encodeURIComponent(slug)}`);
    return (cache[slug] = {
        at: Date.now(),
        genres: (d.genres ?? []).map(({ slug, name }) => ({ slug, name: name.trim() })),
        people: [d.author, d.artist],
    });
}

const qiListing = (genre, page) =>
    getJson(`${QI_API}/series?genre=${encodeURIComponent(genre)}&perPage=100&sort=popular&page=${page}`)
        .then((j) => j.data ?? [])
        .catch(() => []);

// ── Profile and scoring ────────────────────────────────────────────────────

const slugify = (name) => String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const normTitle = (title) => String(title ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Sites fill a missing author with placeholders; matching on those would link
// unrelated comics.
const isPerson = (p) => typeof p === "string" && p.trim().length > 1 && !/^(unknown|n\/?a|tba|-+)$/i.test(p.trim());
const personKey = (p) => p.trim().toLowerCase();

// The user's own 1-10 rating, centred so a 5 or 6 says almost nothing. An unrated
// comic still says something: reading it is mild interest, dropping it is not.
function comicWeight(comic) {
    if (comic.rating != null) return comic.rating - 5.5;
    return comic.status === "dropped" ? -2 : 1;
}

function buildProfile(saved, metaById) {
    const acc = new Map(); // "g:<slug>" | "p:<name>" → { sum, n, name, best }
    const add = (key, name, weight, title) => {
        const a = acc.get(key) ?? { sum: 0, n: 0, name, best: null };
        a.sum += weight;
        a.n++;
        if (weight > 0 && (!a.best || weight > a.best.weight)) a.best = { title, weight };
        acc.set(key, a);
    };
    for (const comic of saved) {
        const weight = comicWeight(comic);
        const meta = metaById.get(comic.id);
        // The user's own genre tags count too; they match site genres by slug.
        const genres = new Map((meta?.genres ?? []).map((g) => [g.slug, g.name]));
        for (const name of comic.genres ?? []) if (!genres.has(slugify(name))) genres.set(slugify(name), name);
        for (const [slug, name] of genres) add(`g:${slug}`, name, weight, comic.title);
        const people = new Map((meta?.people ?? []).filter(isPerson).map((p) => [personKey(p), p.trim()]));
        for (const [key, name] of people) add(`p:${key}`, name, weight, comic.title);
    }
    // Shrunk toward zero: one comic rated 9 says less about a genre than five do.
    const affinity = (key) => {
        const a = acc.get(key);
        return a ? a.sum / (a.n + 1) : 0;
    };
    const top = (prefix, n) =>
        [...acc.keys()]
            .filter((k) => k.startsWith(prefix) && affinity(k) > 0)
            .sort((a, b) => affinity(b) - affinity(a))
            .slice(0, n)
            .map((k) => ({ slug: k.slice(prefix.length), name: acc.get(k).name }));
    return { affinity, entry: (key) => acc.get(key), top };
}

// `credits` counts the catalog entries each person appears on. A studio credited
// on dozens of series says little about taste; an author with two says a lot.
function score(entry, profile, credits) {
    const reasons = [];
    const genres = entry.genres.map((g) => ({ ...g, a: profile.affinity(`g:${g.slug}`) }));
    // Divided by the root of the count, so a long genre list is not a win by itself.
    const genreScore = genres.reduce((s, g) => s + g.a, 0) / Math.sqrt(genres.length || 1);
    const liked = genres.filter((g) => g.a > 0.3).sort((a, b) => b.a - a.a).slice(0, 3);
    if (liked.length) reasons.push(liked.map((g) => g.name).join(", "));

    let personScore = 0;
    let match = null;
    for (const p of new Set(entry.people.filter(isPerson).map(personKey))) {
        const a = profile.affinity(`p:${p}`) / Math.sqrt(credits.get(p) ?? 1);
        if (Math.abs(a) > Math.abs(personScore)) {
            personScore = a;
            match = profile.entry(`p:${p}`);
        }
    }
    if (personScore > 0.5 && match.best) reasons.push(`${match.name}, who also made ${match.best.title}`);

    // Site ratings cluster high, so 0.8 of the scale is neutral and it only tips
    // close calls.
    const siteScore = entry.rating != null ? (entry.rating - 0.8) * 5 : 0;
    if (entry.ratingLabel) reasons.push(`rated ${entry.ratingLabel} on ${SITE_NAMES[entry.site]}`);

    return { total: genreScore + 2 * personScore + siteScore, reasons };
}

// ── Build ──────────────────────────────────────────────────────────────────

async function build(say) {
    const { comics = {}, qiDetails = {} } = await chrome.storage.local.get(["comics", "qiDetails"]);
    const saved = Object.values(comics);
    const errors = [];

    const asuraList = await asuraEntries(say).catch((e) => {
        errors.push(`AsuraScans: ${e.message}`);
        return [];
    });
    const metaById = new Map(asuraList.map((e) => [e.id, e]));

    const savedQi = saved.filter((c) => c.site === qi.host && c.slug);
    say(`Reading ${savedQi.length} saved Qi Manga series…`);
    await mapLimit(savedQi, CONCURRENCY, async (c) => {
        const d = await qiDetail(c.slug, qiDetails).catch(() => null);
        if (d) metaById.set(c.id, d);
    });

    const profile = buildProfile(saved, metaById);

    // Only genres Qi actually has: an unknown genre slug could come back as an
    // unfiltered list and tag every series with it.
    say("Reading Qi Manga listings…");
    const qiGenres = await getJson(`${QI_API}/series/genres`).catch((e) => {
        errors.push(`Qi Manga: ${e.message}`);
        return [];
    });
    const qiSlugs = new Set(qiGenres.map((g) => g.slug));
    const scan = profile.top("g:", 50).filter((g) => qiSlugs.has(g.slug)).slice(0, QI_GENRES);
    const qiById = new Map();
    for (const genre of scan) {
        const lists = await mapLimit(range(1, QI_PAGES_PER_GENRE), CONCURRENCY, (page) => qiListing(genre.slug, page));
        for (const s of lists.flat()) {
            if (!qiById.has(s.slug)) qiById.set(s.slug, qiEntry(s));
            qiById.get(s.slug).genres.push(genre);
        }
    }

    const savedIds = new Set(saved.map((c) => c.id));
    const savedTitles = new Set(saved.map((c) => normTitle(c.title)));
    const candidates = [...asuraList, ...qiById.values()].filter(
        (e) => !savedIds.has(e.id) && !savedTitles.has(normTitle(e.title))
    );
    const rank = () => {
        const credits = new Map();
        for (const e of candidates) {
            for (const p of new Set(e.people.filter(isPerson).map(personKey))) credits.set(p, (credits.get(p) ?? 0) + 1);
        }
        return candidates.map((e) => ({ e, ...score(e, profile, credits) })).sort((a, b) => b.total - a.total);
    };

    // Qi entries are first ranked on listing membership alone; the best get the
    // detail call, and only fully known entries make the final list.
    const toDetail = rank().filter((r) => !r.e.complete).slice(0, QI_DETAIL_TOP);
    say(`Reading details for ${toDetail.length} Qi Manga candidates…`);
    await mapLimit(toDetail, CONCURRENCY, async ({ e }) => {
        const d = await qiDetail(e.slug, qiDetails).catch(() => null);
        if (d) Object.assign(e, { genres: d.genres, people: d.people, complete: true });
    });

    // The same series on both sites shows once, under the better score.
    const seen = new Set();
    const items = rank()
        .filter((r) => r.e.complete && !seen.has(normTitle(r.e.title)) && seen.add(normTitle(r.e.title)))
        .slice(0, SHOWN)
        .map(({ e, reasons }) => ({
            title: e.title,
            url: e.url,
            cover: e.cover,
            site: SITE_NAMES[e.site],
            genres: e.genres.map((g) => g.name),
            reasons,
        }));

    for (const [slug, d] of Object.entries(qiDetails)) {
        if (Date.now() - d.at > QI_DETAIL_TTL_MS) delete qiDetails[slug];
    }
    const recommendations = {
        builtAt: new Date().toISOString(),
        items,
        errors,
        savedCount: saved.length,
        ratedCount: saved.filter((c) => c.rating != null).length,
        topGenres: profile.top("g:", 6).map((g) => g.name),
    };
    await chrome.storage.local.set({ qiDetails, recommendations });
    return recommendations;
}

// ── Page ───────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children.filter((c) => c != null));
    return node;
}

function render(rec) {
    const ago = Math.round((Date.now() - new Date(rec.builtAt).getTime()) / 60000);
    $("summary").textContent =
        `Built ${ago < 1 ? "just now" : `${ago} min ago`} from ${rec.savedCount} saved comics, ${rec.ratedCount} of them rated.` +
        (rec.ratedCount < 3 ? " Rate a few more for sharper suggestions." : "");
    $("taste").textContent = rec.topGenres.length ? `Your strongest genres: ${rec.topGenres.join(", ")}` : "";
    $("errors").replaceChildren(...rec.errors.map((e) => el("div", { textContent: `Could not read ${e}` })));
    $("list").replaceChildren(
        ...rec.items.map((item) =>
            el(
                "li",
                { className: "card" },
                item.cover ? el("img", { className: "cover", src: item.cover, alt: "", loading: "lazy" }) : el("div", { className: "cover" }),
                el(
                    "div",
                    { className: "body" },
                    el("a", { className: "title", href: item.url, target: "_blank", rel: "noopener", textContent: item.title }),
                    el("div", { className: "site", textContent: item.site }),
                    el("div", { className: "reasons", textContent: item.reasons.join(" · ") }),
                    el("div", { className: "chips" }, ...item.genres.map((g) => el("span", { className: "chip", textContent: g })))
                )
            )
        )
    );
    if (!rec.items.length) $("list").replaceChildren(el("li", { className: "empty", textContent: "Nothing to suggest yet." }));
}

async function refresh() {
    const btn = $("btn-build");
    btn.disabled = true;
    try {
        render(await build((text) => ($("summary").textContent = text)));
    } catch (e) {
        $("summary").textContent = `Failed: ${e.message}`;
    } finally {
        btn.disabled = false;
    }
}

(async () => {
    const { settings = {}, recommendations } = await chrome.storage.local.get(["settings", "recommendations"]);
    if (settings.popupTheme === "light") document.body.setAttribute("data-theme", "light");
    $("btn-build").addEventListener("click", refresh);
    if (recommendations) render(recommendations);
    else refresh();
})();
