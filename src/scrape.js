// Page scraper. Split out of content.js so the service worker can inject it as a
// file when the content script is missing, without dragging in content.js's side
// effects (listeners, dark mode, the navigation observer).
//
// No top-level statements: this file is evaluated a second time in tabs that
// never loaded the content script.

// Trailing chapter marker in a page title, in the two shapes seen so far:
// "Solo Leveling chapter 12" and "My Avatars' Path to Greatness – Ch. 88".
const TITLE_CHAPTER_RE = /\s*[-–—|·]?\s*\bch(?:apter)?\b\.?\s*\d+.*$/i;

// SITES, parseComicUrl(), siteFor() and comicId() live in urls.js, loaded before
// this file in both the content_scripts entry and the injection fallback.
function scrapeComic() {
  const addr = parseComicUrl(location.href);
  if (!addr) return scrapeGeneric();
  const site = siteFor(addr.site);
  // Priority is by selector, not by document order — a comma-joined selector
  // would hand a header's sr-only h1 the win over the breadcrumb.
  const raw = site.titleSelectors
    .map((sel) => document.querySelector(sel)?.textContent?.trim())
    .find(Boolean)
    || document.title.replace(/\s+[-–—|·].*$/, "").trim();
  return {
    id: comicId(site, addr.slug),
    title: raw.replace(TITLE_CHAPTER_RE, "").trim(),
    chapter: addr.chapter,
    site: addr.site,
    // The address, split: every link is rebuilt from these two fields.
    urlRoot: addr.urlRoot, slug: addr.slug,
    ...(addr.chapterSep && { chapterSep: addr.chapterSep }),
    // Index pages only — a chapter page's og:image is the reader's own artwork.
    ...(addr.chapter == null && {
      coverUrl: document.querySelector('meta[property="og:image"]')?.content ?? null,
    }),
  };
}

function scrapeGeneric() {
  const title = document.title.replace(/\s*[|–\-].*$/, "").trim() || location.hostname;
  const id = "generic__" + (location.hostname + location.pathname).replace(/[^a-z0-9]/gi, "").slice(0, 24);
  return { id, title, chapter: null, indexUrl: location.href, site: location.hostname };
}
