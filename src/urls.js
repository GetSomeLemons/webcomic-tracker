// Comic addresses. Loaded by the service worker (importScripts), the content
// script, and the popup, so all three build links the same way.
//
// A comic stores its address as urlRoot + slug, never as whole URLs. AsuraScans
// rotates the slug, so a stored index URL and a stored chapter URL go stale at
// the same moment and have to be rewritten separately. With the slug held once,
// a rotation is a single write and every link is rebuilt from it.

// Matches an AsuraScans comic address: origin + path type, then the slug.
const COMIC_URL_RE = /^(https?:\/\/[^/]+\/(?:manga|comics))\/([^/?#]+)/i;

// AsuraScans appends a rotating hex suffix to slugs (e.g. "-30e93729") that
// changes periodically, presumably to break saved links and scrapers. Strip it
// so the same comic keeps one stable storage id across the rotation.
function stableSlug(slug) {
  return String(slug ?? "").replace(/-[0-9a-f]{6,10}$/i, "");
}

// "https://asurascans.com/manga/solo-leveling-30e93729/chapter/12"
//   → { urlRoot: "https://asurascans.com/manga", slug: "solo-leveling-30e93729" }
function parseComicUrl(url) {
  const m = String(url ?? "").match(COMIC_URL_RE);
  return m ? { urlRoot: m[1], slug: m[2] } : null;
}

// A fresh address is only adopted when it still resolves to the same comic id,
// so a redirect that lands somewhere else cannot take over the entry.
function ownsAddress(id, address) {
  return !!address && id === `asura__${stableSlug(address.slug)}`;
}

// `url` is the pre-1.5 stored index URL. Still the address of record for
// generic (non-AsuraScans) sites, which have no slug to rotate.
function indexUrl(comic) {
  if (comic?.urlRoot && comic?.slug) return `${comic.urlRoot}/${comic.slug}/`;
  return comic?.url ?? null;
}

// Chapter URLs are derived per render, so they follow the current slug instead
// of pointing at whatever the slug was on the day the chapter was read.
function chapterUrl(comic, chapter) {
  if (chapter == null || !comic?.urlRoot || !comic?.slug) return null;
  return `${comic.urlRoot}/${comic.slug}/chapter${comic.chapterSep ?? "/"}${chapter}/`;
}

// Most recently visited chapter — where the user actually left off, which is not
// always the furthest one read (lastChapter).
function lastReadChapter(comic) {
  const hist = comic?.chapterHistory ?? [];
  if (!hist.length) return comic?.lastChapter ?? null;
  return hist.reduce((a, b) => ((a.visitedAt ?? "") >= (b.visitedAt ?? "") ? a : b)).chapter;
}
