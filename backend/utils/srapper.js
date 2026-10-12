import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import dotenv from "dotenv"
import { isBlockedCategoryName, isBlockedBanner, pruneBlockedCategoryNodes, JUNK_TITLE_RE } from "./blocklist.js"
import { categoryTagFor } from "./categoryPath.js"
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = "https://www.mobigo.ie"
const EMAIL = process.env.MOBIGO_EMAIL
const PASSWORD = process.env.MOBIGO_PASSWORD
const MAX_PAGES = 50
// Tab-pool sizes. Overridable from the environment because the ceiling here is
// free RAM, not the supplier: each tab is a Chrome renderer, and a run on a
// machine whose free memory was down to ~3GB (an ordinary desktop Chrome holding
// 8.6GB of tabs) lost the browser during the deep-expansion pass before a single
// product had been crawled. Lower these rather than fight the crash when the
// machine is busy:
//   SCRAPE_CONCURRENCY=3 SCRAPE_DEEP_CONCURRENCY=3 SCRAPE_DESC_CONCURRENCY=4 node utils/scrapeNow.js
const envInt = (name, fallback) => {
    const n = Number(process.env[name])
    return Number.isInteger(n) && n > 0 ? n : fallback
}
const CONCURRENCY = envInt("SCRAPE_CONCURRENCY", 5)
const MAX_RETRIES = 3
// Tabs used by the deep-category expansion pass (nav only — no product pages, so
// these are short page loads) and the depth it refuses to go past, as a backstop
// against a category page that links into a loop the ancestor check can't see.
const DEEP_CONCURRENCY = envInt("SCRAPE_DEEP_CONCURRENCY", 6)
const MAX_CATEGORY_DEPTH = 8
const CHECKPOINT_PATH = path.join(__dirname, "..", "scrape-checkpoint.json")
const REPORT_PATH = path.join(__dirname, "..", "scrape-report.json")
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const launchBrowser = () =>
    puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    })

// True once the Chrome process itself is gone, as opposed to one page timing out.
// Puppeteer renamed isConnected() to the `connected` getter, so accept either.
const browserAlive = (browser) => {
    try {
        if (typeof browser?.connected === "boolean") return browser.connected
        if (typeof browser?.isConnected === "function") return browser.isConnected()
    } catch {
        return false
    }
    return false
}

// Errors that mean "this tab/browser is unusable", not "this page misbehaved".
// Once Chrome's process dies, every remaining navigation fails instantly with one
// of these, which is how the previous run burned through its queue in seconds.
//
// Walks the `cause` chain: scrapeUrl wraps the real navigation failure in a
// "Failed to load <url>" error, so the Puppeteer message this needs to see is one
// level down. Testing only the top-level message made this function always return
// false for the single most important case.
const FATAL_BROWSER_RE =
    /target closed|session closed|protocol error|detached frame|connection closed|browser has disconnected|websocket|target crashed/i
const isFatalBrowserError = (err) => {
    for (let e = err, depth = 0; e && depth < 5; e = e.cause, depth++) {
        if (FATAL_BROWSER_RE.test(e.message || "")) return true
    }
    return false
}

// We only ever read image URLs out of DOM attributes (data-src/src) — never the
// decoded pixels — so blocking image/media/font network requests entirely is
// safe and removes the single biggest source of memory pressure. Without this,
// a long run (356 categories x up to 50 pages x ~40 product thumbnails) loads
// tens of thousands of images into long-lived tabs, and Chrome's renderer
// processes eventually crash from memory exhaustion ("detached Frame" errors
// clustering near the end of every run, independent of any other load on the
// machine — confirmed by reproducing it on a fully idle system).
export async function newPage(browser) {
    const page = await browser.newPage()
    await page.setUserAgent(USER_AGENT)
    await page.setRequestInterception(true)
    page.on("request", (req) => {
        if (["image", "media", "font"].includes(req.resourceType())) req.abort()
        else req.continue()
    })
    return page
}

// ── A browser that survives Chrome dying ──────────────────────────────────────
//
// Long passes over this supplier kill Chrome's process outright — reliably, and
// not only under memory pressure. Once it is gone every call throws, so a pass
// with no recovery converts its whole remaining queue into failures in seconds:
// a 7035-product reconciliation died at ~1400 and recorded the next 1000 products
// as "unreadable" before the exception took the run down with it.
//
// Owns launch, login, and ONE relaunch shared by all workers — they all notice
// the death at the same instant, and N concurrent Chrome launches plus N logins
// is its own failure. Cookies live on the browser, so a relaunch must re-login.
//
// NOTE: scrapeAll below has an equivalent inline (ensureBrowser/freshPage), kept
// separate only because it is already proven on a full crawl. If you change the
// recovery rules, change both.
export function createBrowserKeeper({ maxRelaunches = 3, viewport = { width: 1280, height: 900 } } = {}) {
    let browser = null
    let relaunching = null
    let relaunches = 0

    async function boot() {
        const next = await launchBrowser()
        try {
            const p = await next.newPage()
            await p.setUserAgent(USER_AGENT)
            await p.setViewport(viewport)
            await login(p)
            await p.close().catch(() => {})
        } catch (err) {
            await next.close().catch(() => {})
            throw err
        }
        // Published only once authenticated: handing a half-ready browser to a
        // worker means every page it loads redirects to the login form.
        browser = next
    }

    async function ensure() {
        if (browser && browserAlive(browser)) return
        if (!relaunching) {
            if (relaunches >= maxRelaunches) throw new Error(`browser died ${relaunches} times — giving up`)
            relaunches++
            const attempt = relaunches
            relaunching = (async () => {
                if (browser) {
                    console.warn(`[browser] process is gone — relaunch ${attempt}/${maxRelaunches}, re-authenticating…`)
                    // close() waits for the process to exit, which a wedged Chrome
                    // on Windows does not always do; every worker is parked here.
                    await Promise.race([browser.close().catch(() => {}), sleep(10000)])
                    try {
                        browser.process()?.kill()
                    } catch {
                        // already gone
                    }
                }
                await boot()
                console.log(`[browser] back up and logged in`)
            })().finally(() => {
                relaunching = null
            })
        }
        await relaunching
    }

    return {
        ensure,
        get: () => browser,
        relaunchCount: () => relaunches,
        // A usable tab, relaunching Chrome first if that is what it takes.
        async page() {
            await ensure()
            const p = await newPage(browser)
            await p.setViewport(viewport)
            return p
        },
        async close() {
            if (!browser) return
            await Promise.race([browser.close().catch(() => {}), sleep(10000)])
        },
    }
}

const toSlug = (text) =>
    (text || "")
        .replace(/[^\x00-\x7F]/g, "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "cat"

// Two siblings whose labels slugify identically would be indistinguishable in a
// URL, so the second one onward gets a numeric suffix — same rule the top level
// has always used, applied to every child list the deep expansion grafts on.
const dedupeSiblingSlugs = (nodes) => {
    const seen = new Map()
    for (const n of nodes) {
        const count = seen.get(n.slug) || 0
        seen.set(n.slug, count + 1)
        if (count) n.slug = `${n.slug}-${count}`
    }
    return nodes
}

// A category URL with its query string and trailing slash removed, for comparing
// two links that point at the same node.
const normUrl = (u) => (u || "").split("?")[0].replace(/\/+$/, "")

const cleanImgUrl = (src) => {
    if (!src) return ""
    let u = src.trim()
    if (u.startsWith("//")) u = "https:" + u
    else if (u.startsWith("/")) u = BASE_URL + u
    // Remove thumbnail suffix: -1T.jpg → -1.jpg, -2T.jpg → -2.jpg, etc.
    u = u.replace(/(-\d+)T(\.(jpe?g|png|gif|webp))/i, "$1$2")
    return u.split("?")[0] // strip v-cache and all query params
}

// The supplier moved its login/register forms from .asp to .php (login.asp now
// redirects to Register.php); a dropped session lands on either.
export const isLoggedOutUrl = (url) => /(login|register)\.(asp|php)/i.test(url || "")

// ── 1. Login ──────────────────────────────────────────────────────────────────
async function login(page) {
    if (!EMAIL || !PASSWORD) throw new Error("Set MOBIGO_EMAIL and MOBIGO_PASSWORD in .env")
    console.log("[scraper] Logging in...")
    await page.goto(`${BASE_URL}/login.asp`, { waitUntil: "networkidle2", timeout: 60000 })
    await page.waitForSelector("input[name='email']", { timeout: 15000 })
    await page.click("input[name='email']", { clickCount: 3 })
    await page.type("input[name='email']", EMAIL, { delay: 15 })
    await page.click("input[name='password']", { clickCount: 3 })
    await page.type("input[name='password']", PASSWORD, { delay: 15 })
    await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
        page.click("input[name='Login']"),
    ])
    await sleep(800)
    const url = page.url()
    if (isLoggedOutUrl(url)) {
        throw new Error(`Login failed. Landed on: ${url}`)
    }
    console.log("[scraper] Logged in:", url)
}

export { login }

// Re-login if a navigation silently dropped us back to the login/register page
// (Volusion sessions can expire mid-run on a long scrape — this keeps the whole
// browser context authenticated again since cookies are shared across tabs).
async function ensureLoggedIn(page) {
    if (isLoggedOutUrl(page.url())) {
        console.warn("[scraper] Session appears logged out — re-authenticating...")
        await login(page)
        return true
    }
    return false
}

// ── 2. Scrape full 3-level navigation (ALL nodes, no pruning) ─────────────────
async function scrapeNavigation(page) {
    console.log("[scraper] Scraping navigation...")
    await page.goto(`${BASE_URL}/default.asp`, { waitUntil: "networkidle2", timeout: 60000 })
    await sleep(1200)

    const raw = await page.evaluate((base) => {
        const makeSlug = (text) =>
            (text || "")
                .replace(/[^\x00-\x7F]/g, "")
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 80) || "cat"

        const isCatHref = (href) => href && (href.includes("category-s") || href.includes("gsmkits"))

        // The source page renders its nav TWICE — once inside the desktop
        // `.left-nav` sidebar and once inside the mobile `.push-menu` drawer —
        // with duplicate `id="display_menu_N"` on both copies. Scope to the
        // desktop sidebar (and keep only the first copy of each menu id as a
        // belt-and-braces fallback) or every category gets scraped twice.
        const navRoot = document.querySelector(".left-nav") || document

        const cats = []
        const seenMenus = new Set()

        // Each `<nav id="display_menu_N">` is one titled section of the source
        // sidebar, with its heading in a sibling `<div id="MenuN_Title">`:
        // BIG BRANDS, ATTRACTIVE, CASES AND COVERS, TEMPERED GLASS, ACCESSORIES.
        // Persisting that title (rather than guessing sections from name
        // prefixes) is what keeps our sidebar's headings in the source's order.
        navRoot.querySelectorAll("nav[id^='display_menu_']").forEach((menuNav) => {
            if (seenMenus.has(menuNav.id)) return
            seenMenus.add(menuNav.id)

            const menuNumber = menuNav.id.replace("display_menu_", "")
            const titleText = (navRoot.querySelector(`#Menu${menuNumber}_Title`)?.textContent || "").trim()
            // "Nav Menu 8" is Volusion's untouched placeholder for an unused menu.
            const menuTitle = /^nav\s*menu\b/i.test(titleText) ? "" : titleText

            menuNav.querySelectorAll(":scope ul.vnav--level1 > li.vnav__item").forEach((li) => {
                const catLink = li.querySelector(":scope > a.vnav__link, :scope > a")
                if (!catLink) return

                const name = catLink.textContent
                    .trim()
                    .replace(/[^\x00-\x7F]/g, "")
                    .replace(/^\d+\.\s*/, "")
                    .replace(/^\*+|\*+$/g, "")
                    .trim()
                if (!name || name.length < 2) return

                const href = catLink.getAttribute("href") || ""
                if (!isCatHref(href)) return
                const url = href.startsWith("http") ? href : base + href

                // Level 2 — direct child subnav
                const subUl = li.querySelector(":scope > ul.vnav__subnav, :scope > ul.vnav--level2, :scope > ul[class*='vnav']")
                const items = []

                if (subUl) {
                    subUl.querySelectorAll(":scope > li.vnav__item:not(.view-all)").forEach((subLi) => {
                        const subLink = subLi.querySelector(":scope > a")
                        if (!subLink) return
                        const subName = subLink.textContent.trim().replace(/[^\x00-\x7F]/g, "").trim()
                        if (!subName || subName.length < 2) return
                        const subHref = subLink.getAttribute("href") || ""
                        if (!isCatHref(subHref)) return
                        const subUrl = subHref.startsWith("http") ? subHref : base + subHref
                        const subSlug = makeSlug(subName)

                        // Level 3 — direct child subnav of this level-2 item
                        const subSubUl = subLi.querySelector(":scope > ul.vnav__subnav, :scope > ul.vnav--level3, :scope > ul[class*='vnav']")
                        const subItems = []
                        if (subSubUl) {
                            subSubUl.querySelectorAll(":scope > li.vnav__item:not(.view-all) > a").forEach((a) => {
                                const ssName = a.textContent.trim().replace(/[^\x00-\x7F]/g, "").trim()
                                if (!ssName || ssName.length < 2) return
                                const ssHref = a.getAttribute("href") || ""
                                if (!isCatHref(ssHref)) return
                                const ssUrl = ssHref.startsWith("http") ? ssHref : base + ssHref
                                subItems.push({ label: ssName, slug: makeSlug(ssName), url: ssUrl })
                            })
                        }

                        items.push({ label: subName, slug: subSlug, url: subUrl, items: subItems })
                    })
                }

                cats.push({ name, slug: makeSlug(name), url, items, group: menuTitle })
            })
        })
        return cats
    }, BASE_URL)

    // Deduplicate top-level slugs — but disambiguate collisions instead of dropping them,
    // since a live sidebar node lost here means a missing category on the storefront.
    const seen = new Map()
    const unique = []
    for (const c of raw) {
        const count = seen.get(c.slug) || 0
        seen.set(c.slug, count + 1)
        unique.push(count === 0 ? c : { ...c, slug: `${c.slug}-${count}` })
    }

    // Blocked categories (Bulk Offer / Stock Clearance / LCD Screens / HOTO) are
    // dropped here, at the source — they never reach the DB, the sidebar, or the
    // product crawl. Their URLs are kept so banners linking to them get blocked too.
    const blockedUrls = new Set()
    const kept = unique.filter((c) => {
        if (isBlockedCategoryName(c.name)) {
            blockedUrls.add(c.url)
            console.log(`[scraper] ⛔ blocked category: ${c.name}`)
            return false
        }
        return true
    })

    // Persist the source sidebar's own top-to-bottom position. Mongo's natural
    // document order happens to match insert order today, but nothing guarantees
    // it — an explicit `order` is what the read API sorts on.
    const ordered = kept.map((c, i) => ({ ...c, order: i }))

    const total = ordered.reduce((n, c) => n + 1 + c.items.length + c.items.reduce((m, s) => m + (s.items?.length || 0), 0), 0)
    console.log(`[scraper] Found ${ordered.length} top-level categories (${unique.length - ordered.length} blocked), ${total} total nodes`)
    return { categories: ordered, blockedUrls }
}

// Exported so the nav/sidebar structure can be refreshed on its own (see
// utils/refreshCategories.js) without re-crawling ~6000 products.
export { scrapeNavigation }

// ── 2b. Expand the tree past the three levels the sidebar shows ───────────────
// The source sidebar stops at three levels, but every category PAGE also prints
// its own direct children in a "Choose a sub category:" row
// (`a.subcategory_link` > `span.subcategory_name`) — and that row exists at every
// depth. So the levels the sidebar never renders are recoverable by reading that
// row from each sidebar leaf, then from each node that turns up, until nothing
// new appears. On mobigo that is where "Mobile Cases By Brand > Apple > iPhone 11
// Series" continues into "iPhone 11 (6.1) / iPhone 11 Pro (5.8) / iPhone 11 Pro
// Max (6.5)", and Samsung/Xiaomi/Google go one and two levels deeper again.
//
// Only sidebar LEAVES are crawled: a node the sidebar already gave children for
// lists exactly those same children here (verified across all 345 sidebar nodes),
// so re-reading them would just re-confirm what we have.
async function readChildCategories(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    if (isLoggedOutUrl(page.url())) {
        await ensureLoggedIn(page)
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    }
    return page.evaluate((base) => {
        const out = []
        document.querySelectorAll("a.subcategory_link").forEach((a) => {
            const label = (a.querySelector("span.subcategory_name")?.textContent || a.textContent || "")
                .replace(/[^\x00-\x7F]/g, "")
                .trim()
            const href = a.getAttribute("href") || ""
            if (!label || label.length < 2 || !href) return
            if (!href.includes("category-s") && !href.includes("gsmkits")) return
            out.push({ label, url: href.startsWith("http") ? href : base + href })
        })
        return out
    }, BASE_URL)
}

export async function expandCategoryTree(browser, categories) {
    console.log("[scraper] Expanding category tree past the sidebar's 3 levels...")

    // Every node already placed in the tree. A deeper page linking back to one of
    // them (mobigo cross-links heavily) is left alone rather than grafted on a
    // second time, so each node keeps exactly one home in our tree.
    const placed = new Set()
    const leaves = []
    const walk = (node, ancestors) => {
        const key = normUrl(node.url)
        placed.add(key)
        const trail = new Set(ancestors).add(key)
        const children = node.items || []
        if (children.length) {
            // Paths are identities, so two siblings must never slugify the same —
            // true of the sidebar's own levels today, enforced here regardless.
            dedupeSiblingSlugs(children)
            for (const child of children) walk(child, trail)
        } else {
            leaves.push({ node, depth: trail.size, ancestors: trail })
        }
    }
    for (const cat of categories) walk(cat, new Set())

    const pages = []
    for (let i = 0; i < DEEP_CONCURRENCY; i++) pages.push(await newPage(browser))

    const byDepth = {}
    let added = 0
    let visited = 0
    try {
        let frontier = leaves
        while (frontier.length) {
            const next = []
            let idx = 0
            await Promise.all(
                pages.map(async (page) => {
                    while (idx < frontier.length) {
                        const entry = frontier[idx++]
                        if (entry.depth >= MAX_CATEGORY_DEPTH) continue
                        let children
                        try {
                            children = await readChildCategories(page, entry.node.url)
                        } catch (err) {
                            console.warn(`  [scraper] deep read failed for ${entry.node.label || entry.node.name}: ${err.message.slice(0, 80)}`)
                            continue
                        }
                        visited++

                        // No await between the .has() and the .add() below, so
                        // concurrent workers can't both claim the same child.
                        const grafted = []
                        for (const child of children) {
                            const key = normUrl(child.url)
                            if (!key || placed.has(key) || entry.ancestors.has(key)) continue
                            if (isBlockedCategoryName(child.label)) continue
                            placed.add(key)
                            grafted.push({ label: child.label, slug: toSlug(child.label), url: child.url, items: [] })
                        }
                        if (!grafted.length) continue

                        dedupeSiblingSlugs(grafted)
                        entry.node.items = grafted
                        added += grafted.length
                        const depth = entry.depth + 1
                        byDepth[depth] = (byDepth[depth] || 0) + grafted.length
                        for (const g of grafted) {
                            next.push({ node: g, depth, ancestors: new Set(entry.ancestors).add(normUrl(g.url)) })
                        }
                    }
                })
            )
            if (Object.keys(byDepth).length) {
                console.log(`[scraper]   ...${visited} pages read, ${added} deep categories found so far`)
            }
            frontier = next
        }
    } finally {
        for (const page of pages) {
            try {
                await page.close()
            } catch {
                // ignore — browser.close() cleans up regardless
            }
        }
    }

    const depths = Object.keys(byDepth).sort()
    console.log(`[scraper] Deep expansion: +${added} categories (${depths.map((d) => `L${d}: ${byDepth[d]}`).join(", ") || "none"})`)

    // Drop blocked nodes now the tree is finished. Doing it here — the one place
    // both the full scrape and the standalone category refresh pass through — means
    // neither the sidebar that gets persisted nor the crawl list built from it by
    // flattenCategoryTree can contain them, so a removed category can never come
    // back on a later run and no product can be filed under one.
    let removed = 0
    for (let i = 0; i < categories.length; i++) {
        const pruned = pruneBlockedCategoryNodes(categories[i])
        if (pruned !== categories[i]) {
            removed++
            categories[i] = pruned
        }
    }
    if (removed) console.log(`[scraper] Pruned blocked category nodes from ${removed} top-level categor${removed === 1 ? "y" : "ies"}`)

    return { added, byDepth }
}

// Every node of the tree, flattened depth-first with the full slug path that led
// to it — the crawl list, and the source of each product's category tag.
export function flattenCategoryTree(categories) {
    const out = []
    const walk = (node, pathSlugs, labels) => {
        out.push({ url: node.url, pathSlugs, label: labels.join(" > ") })
        for (const child of node.items || []) {
            walk(child, [...pathSlugs, child.slug], [...labels, child.label])
        }
    }
    // Top-level categories name themselves `name`; every node below uses `label`.
    for (const cat of categories) walk(cat, [cat.slug], [cat.name])
    return out
}

// ── 3. Scrape hero banners (Owl Carousel on homepage) ─────────────────────────
async function scrapeBanners(page, blockedUrls = new Set()) {
    console.log("[scraper] Scraping hero banners...")
    await page.goto(`${BASE_URL}/default.asp`, { waitUntil: "networkidle2", timeout: 60000 })
    await sleep(1200)

    const raw = await page.evaluate((base) => {
        const stage = document.querySelector("#vSlider .owl-stage")
        if (!stage) return []
        const items = Array.from(stage.querySelectorAll(":scope > .owl-item:not(.cloned)"))
        return items.map((item) => {
            const a = item.querySelector("a")
            const img = item.querySelector("img")
            const rawSrc = img?.getAttribute("data-src") || img?.getAttribute("src") || ""
            const href = a?.getAttribute("href") || ""
            return {
                image: rawSrc,
                link: href.startsWith("http") ? href : href ? base + href : "",
                alt: img?.getAttribute("alt") || "",
            }
        })
    }, BASE_URL)

    const seen = new Set()
    const banners = []
    let blocked = 0
    for (const b of raw) {
        const image = cleanImgUrl(b.image)
        if (!image || seen.has(image)) continue
        seen.add(image)
        // Drop blocklisted banners (girls banner, HOTO) — including any FUTURE
        // banner that links to a blocked category (e.g. a new HOTO campaign).
        const linkBase = (b.link || "").split("?")[0]
        if (isBlockedBanner({ image, link: b.link, alt: b.alt }) || (linkBase && blockedUrls.has(linkBase))) {
            blocked++
            continue
        }
        banners.push({ image, link: b.link, alt: b.alt, order: banners.length })
    }
    console.log(`[scraper] Found ${banners.length} hero banners (${blocked} blocked)`)
    return banners
}

// ── 4. Scrape products from one category URL (all pages), with retry + re-login ─
//
// Volusion serves the same category under more than one URL prefix
// (/category-s/<id>.htm, /www-gsmkits-com-s/<id>.htm, …). Only the category-s form
// accepts paging parameters, but the id is identical in all of them, so match it
// off any "-s/<id>.htm" tail rather than the category-s spelling alone. Three
// nodes use the gsmkits form, including "Apple" with 1726 products — matching only
// category-s left them unpageable, so they returned their first page and stopped.
const CATEGORY_ID_RE = /-s\/(\d+)\.htm/

// Every page of a listing has to be requested with the SAME sort and page size.
// The old crawl asked for page 1 via the bare category URL — whatever ordering and
// page size that category happens to default to — and pages 2+ with sort=13, so the
// two halves came from differently ordered lists: whatever sat in sort=13's
// first-page slot was never fetched at all, while other products arrived twice.
// On "iPhone 11 Series" that silently lost 31 of 147 products. Pinning both
// parameters on every request, page 1 included, is what makes paging coherent.
//
// Page size also can't be assumed: some categories default to 30 and some to 40,
// which is why the old `length < 40 → stop` rule ended iPhone 12 Series (245
// products) after a single page of 30.
const LISTING_SORT = 13

// The source's own pagination is lossy: it drops about one record per page
// boundary, and WHICH records depends on where the boundaries land — the same
// category read at show=40 and show=100 returns different sets, each missing
// products the other has (measured on iPhone 12 Series: 239 vs 243 of 245).
//
// A category that fits in a single page has no boundary and comes back exact, so
// the crawl asks for the largest page the server will actually render. Measured:
// it caps at 500 products per page, and at that size every category up to 500 — the
// overwhelming majority — is complete in one request. iPhone 12 Series went from
// 243/245 to 245/245 this way.
const LISTING_PAGE_SIZE = 500

// Only the handful of categories above that cap still span pages. For those, a
// second pass at a different page size puts different records on the boundaries, so
// the union of the two recovers what either one alone dropped.
const RECOVERY_PAGE_SIZE = 300

// Volusion renders the product grid client-side and fills it progressively, so the
// first `.v-product` appearing does not mean the page is complete — reading then
// captures a partial grid.
//
// Counting NAMED products, and insisting on two identical readings, both matter:
// the wrappers are inserted before their contents are, so a page of 100 briefly
// reads as 100 wrappers of which one is still empty. Extraction skips the nameless
// one and the page quietly yields 99. Waiting for the count to settle — even once
// it has reached the requested page size — is what closes that window.
async function waitForProducts(page) {
    await page.waitForSelector(".v-product, a.productnamecolor", { timeout: 20000 }).catch(() => {})
    let previous = -1
    // 500-product pages take a few seconds to fill, so this has to be willing to
    // wait — but it settles as soon as two readings agree, which is immediate for
    // the small categories that make up most of the tree.
    for (let i = 0; i < 120; i++) {
        const n = await page.evaluate(() => {
            const named = Array.from(document.querySelectorAll(".v-product")).filter((el) =>
                (el.querySelector('span[itemprop="name"]')?.textContent || "").trim(),
            ).length
            // Categories still on the old listing template have no .v-product at all.
            return named || document.querySelectorAll("a.productnamecolor").length
        })
        if (n > 0 && n === previous) return n
        previous = n
        await sleep(250)
    }
    return previous
}

// `tag` is the placement every product found here gets stamped with — see
// categoryTagFor(): the three legacy category fields plus the full-depth `path`.
export async function scrapeUrl(page, startUrl, tag) {
    const catId = (startUrl.match(CATEGORY_ID_RE) || [])[1] || null

    // Deduplicated across every page AND every pass, so a category that ignores
    // `page=` and re-serves the same list can't inflate the count, and the recovery
    // pass below can only ever add products.
    const collected = new Map()
    // The listing's own "We found N results matching your criteria." — the
    // authoritative total, used both to know when to stop and to notice when a node
    // came up short instead of assuming a short page meant the end.
    let expected = null

    await runPass(LISTING_PAGE_SIZE)
    // Only reachable for a category bigger than one page will ever hold.
    if (expected !== null && collected.size < expected && catId) {
        console.log(`  [scraper] ${tag.path}: ${collected.size}/${expected} — second pass at show=${RECOVERY_PAGE_SIZE}`)
        await runPass(RECOVERY_PAGE_SIZE)
    }

    // Short of the listing's own total: say so rather than silently returning a
    // partial category, which is how the previous truncation went unnoticed.
    if (expected !== null && collected.size < expected) {
        console.warn(`  [scraper] ⚠ ${tag.path}: got ${collected.size} of ${expected} products the listing reports`)
    }

    // `expected` goes back to the caller so a run can report its own coverage —
    // every node's count next to the number the source itself advertises — instead
    // of leaving "did we get everything?" unanswerable.
    return { products: [...collected.values()], expected }

    async function runPass(pageSize) {
    const urlForPage = (n) =>
        catId
            ? `${BASE_URL}/category-s/${catId}.htm?searching=Y&sort=${LISTING_SORT}&cat=${catId}&show=${pageSize}&page=${n}`
            : startUrl

    let pageNum = 1
    let seenThisPass = 0
    let previousFirstKey = null

    while (pageNum <= MAX_PAGES) {
        const url = urlForPage(pageNum)

        let loaded = false
        // The ORIGINAL navigation error has to survive this loop. The crawl
        // worker decides whether to relaunch Chrome by inspecting the error
        // message (isFatalBrowserError), and a dead browser announces itself
        // here — as "Protocol error (Page.navigate): Target closed" out of
        // page.goto. Replacing that with a generic "Failed to load <url>", as
        // this did, made every browser death look like an ordinary bad page, so
        // the recovery never fired and the run drained its remaining queue into
        // failedUrls exactly as before.
        let lastErr = null
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                // A 500-product listing is a much heavier page than the 40-product
                // one this used to request, so the load budget is bigger too — a
                // timeout here costs the whole category, and the retry loop below
                // only gets MAX_RETRIES attempts at it.
                await page.goto(url, { waitUntil: "load", timeout: 90000 })
                if (isLoggedOutUrl(page.url())) {
                    await ensureLoggedIn(page)
                    continue // retry this same URL now that we're logged back in
                }
                loaded = true
                break
            } catch (err) {
                lastErr = err
                if (attempt === MAX_RETRIES) {
                    console.warn(`  [scraper] goto failed p${pageNum} after ${MAX_RETRIES} attempts: ${err.message.slice(0, 80)}`)
                } else {
                    await sleep(500 * attempt)
                }
            }
        }
        if (!loaded) throw new Error(`Failed to load ${url}`, { cause: lastErr })

        await waitForProducts(page)

        const { items: products, found } = await page.evaluate((base) => {
            const items = []
            document.querySelectorAll(".v-product").forEach((el) => {
                const nameEl = el.querySelector('span[itemprop="name"]')
                const name = nameEl?.textContent?.trim() || ""
                if (!name || name.length < 2) return

                const titleLink = el.querySelector("a.v-product__title, a.v-product__img")
                const href = titleLink?.getAttribute("href") || ""
                const productUrl = href.startsWith("http") ? href : href ? base + href : ""
                const codeFromUrl = productUrl.match(/\/product-p\/([^/.]+)\.htm/)?.[1] || ""
                const codeFromCart =
                    el.querySelector("a[href*='ProductCode=']")
                        ?.getAttribute("href")
                        ?.match(/ProductCode=([^&]+)/)?.[1] || ""
                const productCode = codeFromUrl || codeFromCart

                const priceEl = el.querySelector('span[itemprop="price"]')
                const price = parseFloat(priceEl?.getAttribute("content") || priceEl?.textContent || "0") || 0

                // Get best available image — check lazy-load attributes before src
                const imgEl = el.querySelector("a.v-product__img img, .v-product__img img, img[src*='vspfiles']")
                let rawImg = ""
                if (imgEl) {
                    rawImg = imgEl.getAttribute("data-src") ||
                             imgEl.getAttribute("data-lazy-src") ||
                             imgEl.getAttribute("data-original") ||
                             imgEl.getAttribute("data-lazy") ||
                             ""
                    // If no lazy-load attr, check srcset for the largest size
                    if (!rawImg) {
                        const srcset = imgEl.getAttribute("srcset") || ""
                        if (srcset) {
                            const best = srcset.split(",")
                                .map((s) => { const p = s.trim().split(/\s+/); return { url: p[0], w: parseInt(p[1] || "1") } })
                                .filter((e) => e.url)
                                .sort((a, b) => b.w - a.w)[0]
                            rawImg = best?.url || ""
                        }
                    }
                    if (!rawImg) rawImg = imgEl.getAttribute("src") || ""
                }

                let stock = 0
                el.querySelectorAll("font[color]").forEach((f) => {
                    if (f.getAttribute("color") === "#009900") {
                        const m = f.textContent.match(/(\d+)\s*in\s*stock/i)
                        stock = m ? parseInt(m[1], 10) : 10
                    }
                })

                items.push({ name, url: productUrl, productCode, price, rawImg, stock })
            })

            // A handful of categories still render the old Volusion listing markup,
            // which has no `.v-product` wrapper at all — just an anchor per product.
            // "Mobile Cases By Brand" is one of them, so without this it reported
            // 2186 results and yielded nothing. This template carries no image and no
            // stock, so those are left empty and `sparse` tells the writer not to
            // overwrite whatever a richer page already stored for the same product.
            if (!items.length) {
                document.querySelectorAll("a.productnamecolor").forEach((a) => {
                    const name = (a.querySelector('span[itemprop="name"]') || a).textContent?.trim() || ""
                    if (!name || name.length < 2) return
                    const href = a.getAttribute("href") || ""
                    const productUrl = href.startsWith("http") ? href : href ? base + href : ""
                    const productCode = productUrl.match(/\/product-p\/([^/.]+)\.htm/)?.[1] || ""
                    const priceText = a.parentElement?.querySelector(".product_productprice")?.textContent || ""
                    const price = parseFloat(priceText.replace(/[^\d.,]/g, "").replace(",", "")) || 0
                    items.push({ name, url: productUrl, productCode, price, rawImg: "", stock: 0, sparse: true })
                })
            }

            // "We found 147 results matching your criteria." — the listing's own total.
            const text = document.body.innerText || ""
            const m = text.match(/We found\s+([\d,]+)\s+results?/i)
            return { items, found: m ? Number(m[1].replace(/,/g, "")) : null }
        }, BASE_URL)

        // Clean image URLs in Node.js (has access to cleanImgUrl helper)
        const cleaned = products.map((p) => ({
            ...p,
            tag,
            images: p.rawImg ? [cleanImgUrl(p.rawImg)] : [],
            rawImg: undefined,
        }))

        if (expected === null && found !== null) expected = found

        let added = 0
        for (const product of cleaned) {
            const key = productKey(product)
            if (!key || collected.has(key)) continue
            collected.set(key, product)
            added++
        }

        const firstKey = cleaned.length ? productKey(cleaned[0]) : null
        console.log(
            `  [p${pageNum}@${pageSize}] ${cleaned.length} products (+${added} new, ${collected.size}${expected !== null ? `/${expected}` : ""}) — ${tag.path}`
        )

        // End of the listing.
        if (!cleaned.length) break

        // Some categories ignore `page=` entirely and re-serve the same list forever
        // (observed on mobigo.ie, e.g. TP-LINK). Detect it by the page repeating
        // rather than by "added nothing": the recovery pass re-reads pages we
        // already have on purpose, so adding nothing is normal for it and must not
        // end the pass before it reaches the boundary records it exists to recover.
        if (pageNum > 1 && firstKey && firstKey === previousFirstKey) {
            console.log(`  [p${pageNum}@${pageSize}] repeats the previous page — stopping`)
            break
        }
        previousFirstKey = firstKey

        // Counted per pass, so each pass knows when it has walked the whole listing
        // even though most of what it sees is already collected.
        seenThisPass += cleaned.length

        if (expected !== null && collected.size >= expected) break
        if (expected !== null && seenThisPass >= expected) break
        // Without an id there is no pageable URL form, so page 1 is all we can get.
        if (!catId) break
        pageNum++
        await sleep(150)
    }
    }
}

function extractBrand(name = "") {
    const brands = [
        "Apple", "Samsung", "Huawei", "Xiaomi", "Nokia", "Sony", "LG", "Motorola",
        "OnePlus", "Google", "Oppo", "Vivo", "Realme", "Anker", "Baseus", "Hoco",
        "ACEFAST", "JBL", "Bose", "Jabra", "Belkin", "Mophie", "Cygnett", "Ventev",
        "Intenso", "iMICE", "imilab", "HOTO", "Ksix", "Aokus", "AMAZON", "STRONG",
        "Yarta", "Duracell", "Energizer", "GP", "Panasonic", "Varta",
    ]
    for (const b of brands) {
        if (name.toLowerCase().includes(b.toLowerCase())) return b
    }
    return name.split(/\s+/)[0] || "Unknown"
}

// Shape a raw scraped product (name/price/images/stock/url) into the persisted
// document shape, given an id already assigned via the run's seenProducts map.
// Shared by the streaming per-batch save and the final in-memory aggregate below,
// so both paths always agree on the same fields for the same product id.
export function finalizeProduct(p, id) {
    const brand = extractBrand(p.name)
    return {
        id,
        name: p.name || "Unknown Product",
        price: p.price || 0,
        originalPrice: p.price || 0,
        brand,
        description: p.name || "",
        longDescription: "",
        images: p.images || [],
        stock: typeof p.stock === "number" ? p.stock : 0,
        rating: 4.0,
        reviewCount: 0,
        tags: [...new Set([brand.toLowerCase(), ...(p.name || "").split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, "")).filter((w) => w.length > 2)])].slice(0, 10),
        isNew: false,
        isSale: false,
        manufacturer: brand,
        productCode: p.productCode || id,
        url: p.url || "",
        createdAt: new Date().toISOString(),
    }
}

const productKey = (p) => p.url || `${p.name}::${p.price}`

// The same URL written two slightly different ways must land on the same key, so
// that "is this product already stored?" cannot be answered wrongly by a trailing
// slash or a v-cache query string.
export const normalizeProductUrl = (u) =>
    (u || "")
        .trim()
        .split("?")[0]
        .replace(/\/+$/, "")
        .toLowerCase()

// A product id that is the same on every run.
//
// The fallback used to be a per-run counter (`prod-000123`), handed out in crawl
// order. Products whose listing tile exposes no product code therefore got a
// DIFFERENT id on every crawl and were re-inserted as brand-new documents each
// time: 74 redundant documents across 8 URLs, and because each re-insert is an
// insert it arrived at the supplier's wholesale price next to the admin's
// marked-up copy — the same iPhone case was on the storefront at €15, €10 and €5
// simultaneously.
//
// These URLs do carry the code, just not in the `/product-p/CODE.htm` form the
// extractor looks for — they read `/iPhone-7-Matte-Rose-Gel-Case-p/15100070101004.htm`.
// It is deliberately NOT fed into the primary extractor: ids already stored were
// derived either from the URL (lower case, e.g. `epta800bac`) or from the
// ProductCode= link (canonical case, e.g. `PLYSPS4BLK`), and re-deriving those
// from the URL would change 94 products' ids and duplicate every one of them.
// So this only ever names a product that has no id yet, and is prefixed to keep
// it from colliding with a canonical code that differs only in case.
// Deterministic 32-bit FNV-1a — no randomness, no dependence on crawl order.
const fnv1a = (s) => {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, "0")
}

const stableIdFromUrl = (url, name = "") => {
    const norm = normalizeProductUrl(url)
    const code = norm.match(/-p\/([^/.]+)\.htm/i)?.[1]
    if (code) return `u-${code}`
    if (norm) return `u-${fnv1a(norm)}`
    // A tile can render its name with no anchor at all (a template variant, or a
    // partially loaded page — which the crawler tolerates by design). Hashing the
    // NAME keeps even that product's id stable between runs. Without this the
    // per-run counter was still reachable, and the counter is the whole reason 74
    // duplicate documents exist.
    const n = (name || "").replace(/\s+/g, " ").trim().toLowerCase()
    return n ? `u-n-${fnv1a(n)}` : ""
}

// ── 5. Image-quality upgrade pass ──────────────────────────────────────────────
// Volusion listing pages only expose the tiny "-1.jpg" icon (≈200x200, blurry when
// scaled up). The real photo lives at "-2.jpg" (confirmed 1000x1000 on mobigo.ie),
// with further images at "-3.jpg", "-4.jpg"... We verify each candidate with a HEAD
// request (cheap, no browser) and only swap in URLs that actually exist.
const ICON_SUFFIX_RE = /-1\.(jpe?g|png|gif|webp)$/i

async function headOk(url) {
    try {
        const res = await fetch(url, { method: "HEAD" })
        return res.ok
    } catch {
        return false
    }
}

// Every product photo on the source is named after the product code — code
// "ip15myikatukki" lives at ".../photos/IP15MYIKATUKKI-1.jpg" — which held for all
// 300 products sampled across the catalogue, on a single CDN prefix. That is what
// lets a product whose listing carried no thumbnail at all get its image anyway:
// the old listing template prints no image, so those products would otherwise
// render as blank cards.
//
// The prefix is read off a product that does have an image rather than hardcoded,
// so it still works if the store is moved to another CDN.
function derivePhotoBase(products) {
    for (const p of products) {
        const first = p.images?.[0]
        if (first?.includes("/photos/")) return first.replace(/\/photos\/.*$/, "/photos")
    }
    return null
}

// `photoBaseHint` covers being handed only products that have no image at all —
// then there is nothing in the batch to read the CDN prefix off. Exported so a
// repair run can reuse this exact logic instead of reimplementing it.
export async function upgradeImageResolution(products, onImagesReady, photoBaseHint = null) {
    console.log(`[scraper] Upgrading image resolution for ${products.length} products...`)
    const CONCURRENCY_HEAD = 20
    const MAX_GALLERY = 5
    const photoBase = derivePhotoBase(products) || photoBaseHint
    let idx = 0
    let upgraded = 0
    let recovered = 0

    async function worker() {
        while (idx < products.length) {
            const i = idx++
            const p = products[i]
            let icon = p.images?.[0]
            let rebuiltIcon = false

            // No thumbnail from the listing: rebuild it from the product code and
            // keep it only if it really exists.
            if (!icon && photoBase && p.productCode) {
                for (const ext of ["jpg", "png"]) {
                    const candidate = `${photoBase}/${p.productCode.toUpperCase()}-1.${ext}`
                    if (await headOk(candidate)) {
                        icon = candidate
                        p.images = [icon]
                        rebuiltIcon = true
                        recovered++
                        break
                    }
                }
            }
            if (!icon || !ICON_SUFFIX_RE.test(icon)) continue

            const ext = icon.match(ICON_SUFFIX_RE)[1]
            const base = icon.replace(ICON_SUFFIX_RE, "")
            const gallery = []
            for (let n = 2; n <= MAX_GALLERY; n++) {
                const candidate = `${base}-${n}.${ext}`
                if (await headOk(candidate)) gallery.push(candidate)
                else break
            }
            if (gallery.length) {
                p.images = gallery
                upgraded++
            }
            // Persist only when this product's images actually changed — a rebuilt
            // icon with no larger sizes behind it still has to be saved, or the
            // recovery would exist only in memory for the rest of the run.
            if (gallery.length || rebuiltIcon) {
                if (onImagesReady) {
                    try {
                        await onImagesReady({ id: p.id, images: p.images })
                    } catch (err) {
                        console.warn(`[scraper] onImagesReady hook failed (non-fatal): ${err.message.slice(0, 100)}`)
                    }
                }
            }
        }
    }

    await Promise.all(Array.from({ length: CONCURRENCY_HEAD }, worker))
    console.log(`[scraper] Upgraded ${upgraded}/${products.length} products to full-resolution images`)
    if (recovered) console.log(`[scraper] Rebuilt ${recovered} missing images from their product codes`)
}

// ── 6. Description scraping ────────────────────────────────────────────────────
// Listing pages never show a description — it only exists on each product's own
// detail page as #product_description (itemprop="description"). Visits every
// product URL with its own small tab pool, reusing the already-authenticated
// browser context.
const DESC_CONCURRENCY = envInt("SCRAPE_DESC_CONCURRENCY", 8)
// How long a worker waits after hitting a Cloudflare challenge before retrying.
const BLOCKED_BACKOFF_MS = envInt("SCRAPE_BLOCKED_BACKOFF_MS", 20000)

// Everything a product's own detail page can tell us, read in one evaluate() so a
// single navigation answers three separate questions. Shared verbatim by the
// description pass below and by utils/syncSupplier.js, so the crawler and the
// reconciler can never disagree about what a page says.
//
//   gone   — the supplier removed the product. Volusion serves a real IIS 404 body
//            titled "The page cannot be found" for a dead product code, with no
//            price element anywhere on it. Both conditions are required: a title
//            match alone would also fire on an error page served during an outage,
//            and deleting the catalogue over a transient blip is unrecoverable.
//   stock  — "Quantity in Stock:1129", or "Quantity in Stock:(Out of Stock)" for
//            zero. Read out of innerText rather than by selector because the
//            figure sits in an unclassed, unidentified nested <table> cell (no id,
//            no class, four levels of <table>/<tbody>/<tr>/<td>) — there is nothing
//            stable to select, but the label text itself has not moved.
//   name / description — safe to refresh. The detail page has no <h1> or
//            [itemprop=name]; document.title is the product name exactly.
//   blocked — the page is not the product at all: Cloudflare's "Just a moment..."
//            challenge (served when the pass requests pages too fast), the
//            logged-out landing page, or anything else with no price element.
//            Nothing on such a page may be written — its title is not the
//            product's name, and taking it as one renamed 4698 products to
//            "Just a moment..." on 2026-10-01. name is returned empty for it.
//
// Price is read but never returned: the store's price is a markup the admin owns,
// and this function is the one place a rescrape could plausibly reach it. Its
// presence is used only as corroboration that the page rendered.
export async function readProductPage(page) {
    return page.evaluate((junkSource) => {
        const body = document.body?.innerText || ""
        const title = (document.title || "").trim()

        const hasPrice = !!document.querySelector('span[itemprop="price"], .product_productprice')
        const gone = /the page cannot be found/i.test(title) && !hasPrice
        const blocked = !gone && (!hasPrice || new RegExp(junkSource, "i").test(title))
        if (blocked) return { gone, blocked, stock: null, hasPrice, name: "", description: "", bodyLength: body.length }

        // "(Out of Stock)" is a real zero, distinct from "we could not read it".
        let stock = null
        const m = body.match(/Quantity\s+in\s+Stock\s*:?\s*(\(\s*Out of Stock\s*\)|[\d,]+)/i)
        if (m) stock = /out of stock/i.test(m[1]) ? 0 : Number(m[1].replace(/,/g, ""))
        if (stock !== null && (!Number.isFinite(stock) || stock < 0)) stock = null

        const descEl = document.querySelector("#product_description, [itemprop='description']")
        const description = descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : ""

        return { gone, blocked, stock, hasPrice, name: title, description, bodyLength: body.length }
    }, JUNK_TITLE_RE.source)
}

// Visits each product's own detail page. Named for what it originally did, but it
// is now the run's change-detection pass: the detail page is the ONLY place the
// supplier exposes availability, and — for products already in the collection —
// the only way to notice that a title, a description or the stock figure moved.
// Returns the list of changes the hooks reported.
async function scrapeDescriptions(browser, products, onProductMeta, onProductGone) {
    console.log(`[scraper] Scraping descriptions for ${products.length} products...`)
    const pages = []
    for (let i = 0; i < DESC_CONCURRENCY; i++) {
        pages.push(await newPage(browser))
    }

    let idx = 0
    let done = 0
    let found = 0
    let inStock = 0
    let gone = 0
    let blocked = 0
    const changes = []
    const RECYCLE_EVERY = 150

    async function worker(initialPage) {
        let page = initialPage
        let sinceRecycle = 0
        while (idx < products.length) {
            const i = idx++
            const prod = products[i]
            if (!prod.url) {
                done++
                continue
            }
            // Local retry loop (not touching the shared idx counter, which other
            // workers are concurrently advancing) — one retry after a re-login.
            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    await page.goto(prod.url, { waitUntil: "domcontentloaded", timeout: 20000 })
                    if (isLoggedOutUrl(page.url())) {
                        await ensureLoggedIn(page)
                        continue
                    }
                    const info = await readProductPage(page)

                    // The supplier has removed this product. Its page title is
                    // literally "The page cannot be found", so writing the page's
                    // title/description here would rename the product to that —
                    // which is why this branch comes first and writes nothing but
                    // availability. Removal itself is utils/syncSupplier.js's call.
                    if (info.gone) {
                        gone++
                        if (onProductGone) {
                            try {
                                const change = await onProductGone({ id: prod.id })
                                if (change) changes.push({ ...change, reason: "removed at supplier" })
                            } catch (err) {
                                console.warn(`[scraper] onProductGone hook failed (non-fatal): ${err.message.slice(0, 100)}`)
                            }
                        }
                        break
                    }

                    // Not the product page (Cloudflare challenge, landing page). Back
                    // off so the challenge can lift, try once more, and if it is
                    // still blocked write NOTHING — the product keeps what it has.
                    if (info.blocked) {
                        if (attempt === 0) {
                            await sleep(BLOCKED_BACKOFF_MS)
                            continue
                        }
                        blocked++
                        break
                    }

                    const desc = info.description
                    if (desc) {
                        prod.longDescription = desc
                        prod.description = desc.length > 200 ? `${desc.slice(0, 200).trim()}…` : desc
                        found++
                    }
                    // This navigation is the only place in the whole run where a
                    // stock figure is visible — the category listings carry none —
                    // so it is the only chance to record a real quantity.
                    if (info.stock !== null) {
                        prod.stock = info.stock
                        if (info.stock > 0) inStock++
                    }
                    if (info.name) prod.name = info.name

                    // One write per product covering everything the supplier is
                    // allowed to change: availability, title, description. The
                    // hook reports back what actually differed.
                    if (onProductMeta) {
                        try {
                            const change = await onProductMeta({
                                id: prod.id,
                                name: info.name,
                                description: prod.description,
                                longDescription: prod.longDescription,
                                stock: info.stock ?? undefined,
                            })
                            if (change) changes.push(change)
                        } catch (err) {
                            console.warn(`[scraper] onProductMeta hook failed (non-fatal): ${err.message.slice(0, 100)}`)
                        }
                    }
                    break
                } catch {
                    // leave description empty on failure — non-fatal, product still usable
                    break
                }
            }
            done++
            sinceRecycle++
            if (done % 200 === 0 || done === products.length) {
                console.log(`[scraper] descriptions ${done}/${products.length} (${found} found)`)
            }
            if (sinceRecycle >= RECYCLE_EVERY && idx < products.length) {
                try {
                    await page.close()
                } catch {
                    // ignore — discarding this tab anyway
                }
                page = await newPage(browser)
                sinceRecycle = 0
            }
        }
        return page
    }

    const finalPages = await Promise.all(pages.map((p) => worker(p)))
    for (const p of finalPages) {
        try {
            await p.close()
        } catch {
            // ignore — browser.close() will clean up regardless
        }
    }
    console.log(
        `[scraper] detail pass done: ${products.length} pages read — ${found} descriptions, ` +
            `${inStock} in stock, ${gone} removed at supplier, ${blocked} blocked/unreadable (left as-is), ` +
            `${changes.length} product(s) changed`
    )
    return changes
}

function writeCheckpoint(products, completed, total) {
    try {
        fs.writeFileSync(
            CHECKPOINT_PATH,
            JSON.stringify({ completed, total, productCount: products.length, savedAt: new Date().toISOString() }, null, 2)
        )
    } catch {
        // best-effort — checkpoint failures should never abort the scrape
    }
}

// ── Main export ───────────────────────────────────────────────────────────────
// `hooks` lets a caller persist results as they're produced instead of waiting for
// the whole run to finish — see onNavigationReady/onBannersReady/onProductBatch/
// onProductMeta/onProductGone/onImagesReady below. All hooks are optional; with
// none passed this just returns the full aggregate at the end.
//
// `hooks.refreshExisting` (default TRUE) makes the run re-read the detail page of
// every product it sees, not only new ones, and report through onProductMeta what
// the supplier changed — availability, title, description. Availability is the
// point: it is the field that moves, the category listings no longer carry it, and
// nothing refreshed it for already-stored products. Price is never read.
//
// `hooks.existingIds` (a Set of product ids already persisted) switches the run
// into incremental mode: products whose id is already in the DB are skipped —
// no re-save, no description scrape, no image upgrade. Only genuinely new
// products get written and enriched, which is what makes rescrapes cheap.
const scrapeAll = async (hooks = {}) => {
    // `let`, not `const`: the crawl below replaces this whole browser if Chrome's
    // process dies mid-run (see ensureBrowser), so every later reader — the
    // description pass and the teardown in `finally` — has to see the live one.
    let browser = await launchBrowser()

    try {
        // `let`: if the browser is relaunched during the pre-crawl steps below,
        // this tab dies with the old process and has to be replaced.
        let mainPage = await newPage(browser)
        await mainPage.setViewport({ width: 1280, height: 900 })

        await login(mainPage)

        // Chrome's renderer has been observed dying outright partway through a long
        // crawl, and once the process is gone every tab call throws instantly. Each
        // worker used to answer that by returning, which silently truncated the run:
        // the 2026-08-30 crawl stopped after 480 of 826 nodes with only 51 URLs
        // recorded as failed, so ~300 category nodes were never visited and nothing
        // in the report said so. Relaunching the browser and re-authenticating lets
        // the crawl continue over the nodes it has not reached yet.
        //
        // Cookies live on the browser, not the tab, so a relaunch has to log in
        // again. One relaunch is shared by all five workers — they all detect the
        // death at the same moment, and five concurrent Chrome launches plus five
        // logins is its own failure.
        let relaunching = null
        let relaunches = 0
        // Env-tunable: on a machine short of RAM the renderer dies more often.
        const MAX_RELAUNCHES = envInt("SCRAPE_MAX_RELAUNCHES", 3)

        async function ensureBrowser() {
            if (browserAlive(browser)) return
            if (!relaunching) {
                if (relaunches >= MAX_RELAUNCHES) {
                    throw new Error(`browser died ${relaunches} times — giving up on relaunching`)
                }
                relaunches++
                const attempt = relaunches
                relaunching = (async () => {
                    console.warn(`[scraper] browser process is gone — relaunch ${attempt}/${MAX_RELAUNCHES}, re-authenticating…`)
                    // Closing a wedged Chrome can hang forever (close() waits for
                    // the process to exit, and a renderer-OOM'd child on Windows is
                    // not always reaped). Every other worker is parked on this
                    // promise, so an unbounded wait here stalls the entire crawl.
                    await Promise.race([browser.close().catch(() => {}), sleep(10000)])
                    try {
                        browser.process()?.kill()
                    } catch {
                        // already gone
                    }

                    // Publish `browser` only once it is fully usable. Assigning it
                    // straight after launchBrowser() let the other four workers
                    // past the browserAlive() check and onto a cookie-less Chrome
                    // while login was still typing — every category they fetched
                    // then redirected to login.asp. Worse, if login() threw, the
                    // module-scope binding was left pointing at a live logged-out
                    // browser that browserAlive() reports as healthy, so no later
                    // ensureBrowser() would ever relaunch it and the whole run
                    // silently scraped nothing.
                    const next = await launchBrowser()
                    try {
                        const p = await newPage(next)
                        await p.setViewport({ width: 1280, height: 900 })
                        await login(p)
                        await p.close().catch(() => {})
                    } catch (err) {
                        await next.close().catch(() => {})
                        throw err
                    }
                    browser = next
                    console.log(`[scraper] relaunched and logged back in — resuming crawl`)
                })().finally(() => {
                    relaunching = null
                })
            }
            await relaunching
        }

        // A usable tab, relaunching the browser first if that is what it takes.
        async function freshPage() {
            await ensureBrowser()
            const p = await newPage(browser)
            await p.setViewport({ width: 1280, height: 900 })
            return p
        }
        const existingIds = hooks.existingIds instanceof Set ? hooks.existingIds : new Set()
        // normalized url -> the id that product is ALREADY stored under. Without
        // this, a product whose id derivation has drifted between releases is seen
        // as new and inserted a second time, at the supplier's price.
        const existingByUrl = hooks.existingByUrl instanceof Map ? hooks.existingByUrl : new Map()
        if (existingIds.size) console.log(`[scraper] Incremental mode: ${existingIds.size} products already in DB will be kept as-is`)
        if (existingByUrl.size) console.log(`[scraper] ${existingByUrl.size} stored URLs mapped to their existing ids (duplicate guard)`)

        const { categories, blockedUrls } = await scrapeNavigation(mainPage)
        // Graft on levels 4-6, which the source sidebar never renders — they only
        // exist in each category page's "Choose a sub category:" row. Runs before
        // onNavigationReady so the sidebar we persist is the full tree, and before
        // the crawl list is built so those nodes get their products too. A failure
        // here costs the deep levels, not the run: the three-level tree and every
        // product under it are still scraped exactly as before.
        try {
            await expandCategoryTree(browser, categories)
        } catch (err) {
            console.warn(`[scraper] deep category expansion failed (non-fatal, keeping the 3-level tree): ${err.message}`)
        }

        // The deep expansion opens DEEP_CONCURRENCY tabs across hundreds of
        // category pages — the same workload, and the same crash site, as the main
        // crawl. Its own failures are treated as non-fatal, but if it took the
        // BROWSER down with it then every step after this point is holding a dead
        // handle. That is not hypothetical: a run died exactly here, with
        // "Session closed" on the banner scrape immediately afterwards, and
        // aborted before a single product had been crawled. Repair it before
        // continuing so the expansion stays as non-fatal as it claims to be.
        if (!browserAlive(browser)) {
            console.warn(`[scraper] browser did not survive the deep expansion — recovering before the crawl`)
            try {
                await ensureBrowser()
                mainPage = await freshPage()
            } catch (err) {
                console.warn(`[scraper] could not recover the browser after deep expansion: ${err.message}`)
            }
        }
        // expandCategoryTree prunes blocked nodes itself, but only if it gets that
        // far — repeat it here so a failed expansion can never be the reason a
        // removed category comes back. pruneBlockedCategoryNodes returns the same
        // object when there is nothing to remove, so doing it twice costs nothing.
        for (let i = 0; i < categories.length; i++) {
            categories[i] = pruneBlockedCategoryNodes(categories[i])
        }
        if (hooks.onNavigationReady) {
            try {
                await hooks.onNavigationReady(categories)
            } catch (err) {
                console.warn(`[scraper] onNavigationReady hook failed (non-fatal): ${err.message}`)
            }
        }

        // Banners are decoration; the products are the run. A bare call here meant
        // a dead tab threw straight out of scrapeAll and cost the entire crawl, so
        // this retries on a fresh tab and then gives up gracefully.
        let banners = []
        try {
            banners = await scrapeBanners(mainPage, blockedUrls)
        } catch (err) {
            console.warn(`[scraper] banner scrape failed — retrying on a fresh tab: ${err.message.slice(0, 100)}`)
            try {
                mainPage = await freshPage()
                banners = await scrapeBanners(mainPage, blockedUrls)
            } catch (err2) {
                console.warn(
                    `[scraper] banner scrape failed again (non-fatal, existing banners kept): ${err2.message.slice(0, 100)}`
                )
                banners = []
            }
        }
        if (hooks.onBannersReady) {
            try {
                await hooks.onBannersReady(banners)
            } catch (err) {
                console.warn(`[scraper] onBannersReady hook failed (non-fatal): ${err.message}`)
            }
        }

        // Every node of the tree at every depth, each with the full slug path that
        // leads to it — no longer three hand-written loops, since the tree now runs
        // to six levels and gains more whenever the supplier adds them.
        const toFetch = flattenCategoryTree(categories)

        // Deduplicate URLs (same page may appear in multiple nav positions)
        const seenUrls = new Set()
        const uniqueFetch = toFetch.filter((f) => {
            if (seenUrls.has(f.url)) return false
            seenUrls.add(f.url)
            return true
        })

        console.log(`\n[scraper] ${uniqueFetch.length} unique URLs to scrape across ${CONCURRENCY} parallel tabs\n`)


        // Set up a small pool of tabs sharing the logged-in session (cookies are
        // per browser-context, not per-page, so every tab is authenticated already).
        // Built through freshPage so a browser that died during the pre-crawl
        // steps is relaunched here rather than handing every worker a dead tab.
        // mainPage is retired instead of being reused as worker 0: it has already
        // been through the nav scrape, the deep expansion and the banner pass, and
        // it may not even belong to the current browser any more.
        const pages = []
        for (let i = 0; i < CONCURRENCY; i++) pages.push(await freshPage())
        try {
            await mainPage.close()
        } catch {
            // already gone with a relaunched browser
        }

        const rawAll = []
        const failedUrls = []
        // One entry per crawled node: what the source says it holds vs what we got.
        const coverage = []
        let nextIdx = 0
        let completed = 0
        const total = uniqueFetch.length

        // Run-scoped id assignment: maps a product's dedup key -> the id it was first
        // assigned this run. Populated synchronously (no awaits between check and set,
        // so concurrent workers can't race each other) as pages are scraped, then reused
        // by the final grouping pass below so streamed saves and the returned aggregate
        // always agree on the same id for the same product.
        const seenProducts = new Map()
        let idCounter = 0

        // A tab that lives through the entire crawl (hundreds of navigations, tens
        // of pages each) accumulates memory until Chrome's renderer crashes —
        // confirmed happening consistently near the end of every run even on an
        // otherwise idle machine. Recycling each worker's tab periodically bounds
        // that growth regardless of what's actually leaking.
        const RECYCLE_EVERY = 15

        // One category node, start to finish. Lifted out of the worker loop so that
        // a node can be retried on a fresh tab after a browser death without any of
        // this being written twice. Safe to retry: scrapeUrl either throws before
        // anything is appended to rawAll/coverage, or returns having appended
        // nothing itself, so a second attempt cannot double-count a product.
        async function processNode(page, item) {
            const { url, pathSlugs, label } = item
            const tag = categoryTagFor(pathSlugs)
            const { products: prods, expected } = await scrapeUrl(page, url, tag)
            rawAll.push(...prods)
            // Recorded for every node so the run's report can be checked
            // against the source category by category.
            coverage.push({ path: tag.path, label, expected, scraped: prods.length })

            // Assign each product's run-scoped id up front (always, so the final
            // grouping pass below can look up the same ids whether or not a
            // streaming hook is in use), then save this node's batch immediately
            // instead of waiting for the entire crawl to finish.
            if (prods.length) {
                const batch = prods.map((p) => {
                    const key = productKey(p)
                    let id = seenProducts.get(key)
                    let isFirstSeen = false
                    if (!id) {
                        // A product already stored under this URL keeps the id it
                        // already has, whatever that id looks like. This is what
                        // stops a re-derived code from minting a second document
                        // for a product the store already sells — the ids in the
                        // collection came from three different derivations over
                        // time (URL-cased codes, ProductCode-cased codes, and
                        // per-run counters), and only the URL is stable across all
                        // three.
                        const known = existingByUrl.get(normalizeProductUrl(p.url))
                        if (known) {
                            id = known
                        } else if (p.productCode && p.productCode.length > 2) {
                            id = p.productCode
                        } else {
                            idCounter++
                            id = stableIdFromUrl(p.url, p.name) || `prod-${String(idCounter).padStart(6, "0")}`
                        }
                        seenProducts.set(key, id)
                        isFirstSeen = true
                    }
                    return {
                        product: finalizeProduct(p, id),
                        tag: p.tag,
                        isFirstSeen,
                        // Came off the old listing template, which carries no
                        // image and no stock — the writer must leave whatever a
                        // richer page already stored for this product alone.
                        sparse: !!p.sparse,
                        // A product already in the DB keeps everything it has —
                        // no re-save, no description/image re-fetch — but THIS
                        // node's placement is still merged into its categoryTags.
                        // That is what lets the newly discovered levels 4-6 fill
                        // up with the 6000 products already scraped, instead of
                        // showing empty until every product happens to be re-added.
                        tagOnly: existingIds.has(id),
                    }
                })
                if (batch.length && hooks.onProductBatch) {
                    try {
                        await hooks.onProductBatch(batch)
                    } catch (err) {
                        console.warn(`[scraper] onProductBatch hook failed (non-fatal): ${err.message.slice(0, 100)}`)
                    }
                }
            }
        }

        async function worker(initialPage) {
            let page = initialPage
            let sinceRecycle = 0
            while (true) {
                const i = nextIdx++
                if (i >= total) break
                const item = uniqueFetch[i]
                try {
                    await processNode(page, item)
                } catch (err) {
                    if (isFatalBrowserError(err)) {
                        // The tab (or the whole browser) is gone. Every later
                        // navigation on it would fail identically, so the rest of the
                        // shared queue would be drained into failedUrls in
                        // milliseconds — which is precisely how the last run "finished"
                        // 346 nodes short. Get a live tab back, relaunching Chrome if
                        // needed, and give this node one more attempt.
                        try {
                            try {
                                await page.close()
                            } catch {
                                // already gone with the browser
                            }
                            page = await freshPage()
                            sinceRecycle = 0
                            await processNode(page, item)
                        } catch (retryErr) {
                            failedUrls.push({ url: item.url, label: item.label, error: retryErr.message })
                            if (!browserAlive(browser)) {
                                console.warn(
                                    `[scraper] worker stopping — browser unrecoverable: ${retryErr.message.slice(0, 100)}`
                                )
                                return null
                            }
                            console.warn(`[scraper] ✗ ${item.label} (after recovery): ${retryErr.message.slice(0, 100)}`)
                        }
                    } else {
                        console.warn(`[scraper] ✗ ${item.label}: ${err.message.slice(0, 100)}`)
                        failedUrls.push({ url: item.url, label: item.label, error: err.message })
                    }
                }
                completed++
                sinceRecycle++
                if (completed % 10 === 0 || completed === total) {
                    console.log(`[scraper] progress ${completed}/${total} nodes, ${rawAll.length} products so far`)
                    writeCheckpoint(rawAll, completed, total)
                }
                if (sinceRecycle >= RECYCLE_EVERY && nextIdx < total) {
                    try {
                        await page.close()
                    } catch {
                        // discarding this tab anyway
                    }
                    try {
                        page = await freshPage()
                        sinceRecycle = 0
                    } catch (err) {
                        console.warn(`[scraper] worker could not get a fresh tab, stopping: ${err.message.slice(0, 100)}`)
                        return null
                    }
                }
            }
            return page
        }

        const finalPages = await Promise.all(pages.map((p) => worker(p)))
        for (const p of finalPages) {
            if (!p) continue
            try {
                await p.close()
            } catch {
                // ignore — browser.close() below will clean up regardless
            }
        }

        // Anything past the shared cursor was never even claimed by a worker — the
        // case where every worker gave up early. That used to leave no trace at all:
        // the run logged "✅ complete", the report showed "all categories matched",
        // and 346 nodes had simply never been opened. A crawl that did not cover the
        // whole tree must say so, loudly, because it is also the signal that decides
        // whether utils/syncSupplier.js is allowed to delete anything.
        const notVisited = uniqueFetch.slice(Math.min(nextIdx, total)).map((f) => ({ url: f.url, label: f.label }))
        const complete = notVisited.length === 0 && failedUrls.length === 0

        console.log(`\n[scraper] Raw total: ${rawAll.length}`)
        if (failedUrls.length) {
            console.warn(`[scraper] ${failedUrls.length} category URLs failed after retries — see scrape-report.json`)
        }
        if (notVisited.length) {
            console.warn(
                `[scraper] ⚠ INCOMPLETE CRAWL: ${notVisited.length} of ${total} category nodes were never visited ` +
                    `(every worker stopped early). Products under them are absent from this run's results.`
            )
        }

        // Group by product URL, merging every category placement found for the same
        // product instead of keeping only the first. mobigo.ie cross-lists products
        // under many categories/brands at once (e.g. a speaker under both its brand
        // page and "Stock Clearance") — dropping the "duplicates" was silently
        // erasing ~70% of category associations even though the product itself
        // was captured fine.
        const groups = new Map()
        for (const p of rawAll) {
            const key = productKey(p)
            if (!key) continue
            if (!groups.has(key)) groups.set(key, { ...p, tags: [] })
            groups.get(key).tags.push(p.tag)
        }
        const unique = Array.from(groups.values())
        console.log(`[scraper] Unique products: ${unique.length}`)

        // Finalize — reuses the same id each product was assigned during the crawl
        // (via seenProducts) so this aggregate lines up with whatever was already
        // streamed to the DB above.
        const products = unique.map((p) => {
            // Same precedence as the crawl's own assignment above, so the aggregate
            // and whatever was streamed to the DB can never disagree about a
            // product's id (a disagreement here is a duplicate document).
            const id =
                seenProducts.get(productKey(p)) ||
                existingByUrl.get(normalizeProductUrl(p.url)) ||
                (p.productCode && p.productCode.length > 2 ? p.productCode : stableIdFromUrl(p.url, p.name)) ||
                `prod-${String(++idCounter).padStart(6, "0")}`

            // The full path identifies a placement now — two different level-6 nodes
            // under the same level-3 parent share all three legacy fields, so keying
            // the dedupe on those would have collapsed them into one.
            const seenTags = new Set()
            const categoryTags = p.tags.filter((t) => {
                if (seenTags.has(t.path)) return false
                seenTags.add(t.path)
                return true
            })
            const primary = categoryTags[0] || {}

            return {
                ...finalizeProduct(p, id),
                category: primary.category || "accessories",
                subcategory: primary.subcategory || primary.category || "accessories",
                subsubcategory: primary.subsubcategory || "",
                categoryTags,
            }
        })

        // Descriptions (browser-based) and image upgrades (plain HTTP HEAD) touch
        // disjoint fields on the same product objects, so they run concurrently.
        // These mutate `products` in place, so even a catastrophic failure here
        // (e.g. the whole browser crashing) must not throw away everything the
        // crawl above already built — worst case we save products with default
        // images/descriptions for whichever ones hadn't been processed yet.
        // In incremental mode only NEW products are enriched — visiting every
        // already-saved product's detail page is what made rescrapes slow.
        // `refreshExisting` decides whether this run only fills in NEW products or
        // re-reads every product it saw.
        //
        // Skipping products already in the collection is what made rescrapes cheap,
        // but it also meant nothing ever noticed the supplier changing anything: a
        // product's stock, title and description were frozen at whatever the run
        // that first saw it recorded. Stock is the field that moves constantly —
        // 4836 of 7108 products were carrying a wrong figure, and 659 of those were
        // showing out-of-stock while the supplier held real quantities — so tracking
        // it is the entire reason the scrape runs on a schedule.
        //
        // The cost is one page load per product instead of per new product. Prices
        // are not part of that: nothing in this pass can write price.
        let supplierChanges = []
        const refreshExisting = hooks.refreshExisting !== false
        const toEnrich = refreshExisting || !existingIds.size ? products : products.filter((p) => !existingIds.has(p.id))
        if (refreshExisting) {
            console.log(
                `[scraper] Re-reading all ${toEnrich.length} products for availability/title/description changes ` +
                    `(prices are never read)`
            )
        } else if (existingIds.size) {
            console.log(`[scraper] Enriching ${toEnrich.length} new products (${products.length - toEnrich.length} already in DB, skipped)`)
        }
        try {
            const [metaChanges] = await Promise.all([
                scrapeDescriptions(browser, toEnrich, hooks.onProductMeta, hooks.onProductGone),
                upgradeImageResolution(toEnrich, hooks.onImagesReady),
            ])
            supplierChanges = metaChanges ?? []
        } catch (err) {
            console.warn(`[scraper] description/image enrichment pass failed (non-fatal, keeping ${products.length} products as-is): ${err.message}`)
        }

        // Keep ALL categories exactly as found on the live sidebar — a category with
        // zero products today (or one whose fetch failed) should still appear in nav,
        // matching mobigo.ie's own sidebar 1:1.
        try {
            const short = coverage
                .filter((c) => c.expected !== null && c.scraped < c.expected)
                .sort((a, b) => b.expected - b.scraped - (a.expected - a.scraped))
            fs.writeFileSync(
                REPORT_PATH,
                JSON.stringify(
                    {
                        completedAt: new Date().toISOString(),
                        totalNodes: total,
                        nodesVisited: completed,
                        // The one field to check before trusting "this product is not
                        // on the supplier site any more".
                        complete,
                        productCount: products.length,
                        failedUrls,
                        notVisited,
                        // Every node checked against the source's own
                        // "We found N results" count. `short` is the answer to
                        // "are any categories still missing products?" — it should
                        // be empty, and anything in it names the category and the gap.
                        coverage: { nodes: coverage.length, short: short.length, details: short },
                    },
                    null,
                    2
                )
            )
            if (short.length) {
                console.warn(`[scraper] ${short.length} categories came up short of the source's own count — see scrape-report.json`)
                for (const c of short.slice(0, 10)) console.warn(`   ${c.scraped}/${c.expected}  ${c.label}`)
            } else {
                console.log(`[scraper] coverage: all ${coverage.length} categories matched the source's own product counts`)
            }
        } catch {
            // best-effort
        }

        console.log(
            `\n[scraper] ${complete ? "✅" : "⚠"} ${products.length} products, ${categories.length} categories, ` +
                `${banners.length} banners — ${completed}/${total} nodes visited${complete ? "" : " (INCOMPLETE)"}`
        )
        // `crawl` is what lets a caller tell "the supplier no longer lists this
        // product" apart from "our crawler never got to the page that lists it".
        // Only the first of those justifies deleting anything.
        return {
            categories,
            products,
            banners,
            // verifiedPaths: nodes this run crawled AND collected in full against
            // the listing's own "We found N" count. The only nodes whose absence of
            // a product reconcileCatalogue treats as evidence — a node that failed,
            // came up short, showed no count, or was never in this run's tree at
            // all proves nothing.
            crawl: {
                complete,
                totalNodes: total,
                nodesVisited: completed,
                failedUrls,
                notVisited,
                verifiedPaths: coverage
                    .filter((c) => c.expected !== null && c.scraped >= c.expected)
                    .map((c) => c.path),
            },
            // What the supplier changed on products we already had: availability,
            // title, description. Never price.
            supplierChanges,
        }
    } finally {
        // A throw here (e.g. Windows locking a temp profile file during cleanup)
        // would otherwise mask a successful return from the try block above —
        // the scrape already succeeded, so a failed browser teardown must never
        // take the results down with it.
        try {
            await browser.close()
        } catch (err) {
            console.warn("[scraper] browser.close() failed (non-fatal):", err.message)
        }
    }
}

export default scrapeAll
