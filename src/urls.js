// Comic addresses. Loaded by the service worker (importScripts), the content
// script, and the popup, so all three build links the same way.
//
// A comic stores its address as urlRoot + slug, never as whole URLs. Sites that
// rotate their slugs (AsuraScans does) would otherwise invalidate a stored index
// URL and a stored chapter URL at the same moment, each needing its own rewrite.
// With the slug held once, a rotation is a single write and every link is
// rebuilt from it.

// Every supported site, one entry each. Nothing else in the extension names a
// site: the scraper, the link builders and the update check are all generic over
// this table, so adding a site is adding a row (plus its origin in
// manifest.json's host_permissions).
const SITES = [
    {
        id: "asura",                 // storage id prefix: `${id}__${stableSlug}`
        host: "asurascans.com",      // also the comic's `site` field — do not change
        pathType: "manga|comics",    // regex alternation, dropped into the URL pattern
        chapterSep: "/",             // default; a value read off a chapter page wins
        // Tried in order, first with text wins. The first three no longer match the
        // live site — kept because this markup has churned before and they cost a
        // miss each.
        titleSelectors: [".breadcrumb a[href*='/manga/']", ".breadcrumb a[href*='/comics/']", ".entry-title", "h1"],
        // AsuraScans appends a rotating hex suffix to slugs (e.g. "-30e93729"),
        // presumably to break saved links and scrapers. Strip it so one comic keeps
        // one storage id across the rotation. No field means the slugs are stable.
        slugSuffix: /-[0-9a-f]{6,10}$/i,
    },
    {
        id: "qi",
        host: "qimanga.com",
        pathType: "series",
        chapterSep: "-",             // /chapter/88 is a hard 404 here
        // The series page carries h1.series-title; a chapter page only has an
        // sr-only h1 holding "<title> – Ch. N", which the title cleanup trims.
        titleSelectors: ["h1.series-title", "h1"],
    },
];

// Every site addresses a comic as origin/pathType/slug[/chapter<sep><n>], so the
// pattern is derived once per site rather than written out per row. The origin is
// pinned to the apex: host_permissions covers only that, and www.qimanga.com
// answers 400, so a host taken from the page would break background fetches.
for (const s of SITES) {
    s.origin = `https://${s.host}`;
    s.re = new RegExp(
        `^https?://(?:www\\.)?${s.host.replace(/\./g, "\\.")}` +
        `/(${s.pathType})/([^/?#]+)(?:/chapter([/-])(\\d+))?/?(?:[?#]|$)`, "i");
}

const siteFor = (host) => SITES.find((s) => s.host === host) ?? null;

// The result is plain JSON — `site` is the host string, not the descriptor
// object. The address crosses chrome.runtime.sendMessage, which serializes as
// JSON, so a RegExp field would arrive as an empty {}. It also lands in storage.
//
// "https://qimanga.com/series/my-avatars/chapter-88"
//   → { site: "qimanga.com", urlRoot: "https://qimanga.com/series",
//       slug: "my-avatars", chapterSep: "-", chapter: 88 }
function parseComicUrl(url) {
    for (const site of SITES) {
        const m = String(url ?? "").match(site.re);
        if (!m) continue;
        return {
            site: site.host,
            urlRoot: `${site.origin}/${m[1]}`,
            slug: m[2],
            chapterSep: m[3] ?? null,
            chapter: m[4] ? parseInt(m[4], 10) : null,
        };
    }
    return null;
}

const stableSlug = (site, slug) =>
    site?.slugSuffix ? String(slug ?? "").replace(site.slugSuffix, "") : String(slug ?? "");

const comicId = (site, slug) => `${site.id}__${stableSlug(site, slug)}`;

// A fresh address is only adopted when it still resolves to the same comic id,
// so a redirect that lands somewhere else cannot take over the entry.
function ownsAddress(id, address) {
    const site = siteFor(address?.site);
    return !!site && id === comicId(site, address.slug);
}

// `url` is the pre-1.5 stored index URL. Still the address of record for
// generic (unsupported-site) comics, which have no slug to rotate.
function indexUrl(comic) {
    if (comic?.urlRoot && comic?.slug) return `${comic.urlRoot}/${comic.slug}/`;
    return comic?.url ?? null;
}

// Chapter URLs are derived per render, so they follow the current slug instead
// of pointing at whatever the slug was on the day the chapter was read.
function chapterUrl(comic, chapter) {
    if (chapter == null || !comic?.urlRoot || !comic?.slug) return null;
    // The stored separator wins when a chapter page was actually seen; the site
    // default covers comics only ever tracked from their index page. Without that
    // fallback a qimanga comic's whole chapter history would be 404 links.
    const sep = comic.chapterSep ?? siteFor(comic.site)?.chapterSep ?? "/";
    return `${comic.urlRoot}/${comic.slug}/chapter${sep}${chapter}/`;
}

// Most recently visited chapter — where the user actually left off, which is not
// always the furthest one read (lastChapter).
function lastReadChapter(comic) {
    const hist = comic?.chapterHistory ?? [];
    if (!hist.length) return comic?.lastChapter ?? null;
    return hist.reduce((a, b) => ((a.visitedAt ?? "") >= (b.visitedAt ?? "") ? a : b)).chapter;
}
