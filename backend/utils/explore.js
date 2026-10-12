/**
 * Run this ONCE to explore mobigo.ie's HTML structure.
 * Output is saved to be-eominio/site-structure.json
 * Usage:  node utils/explore.js
 */

import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = "https://www.mobigo.ie"

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
const page = await browser.newPage()
await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

console.log("Visiting homepage...")
await page.goto(`${BASE_URL}/default.asp`, { waitUntil: "networkidle2", timeout: 60000 })

// ── Dump ALL links ────────────────────────────────────────────────────────────
const allLinks = await page.evaluate(() =>
    Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        text: a.textContent.trim().slice(0, 80),
        href: a.getAttribute("href"),
        parent: a.parentElement?.tagName + "." + (a.parentElement?.className || "").split(" ")[0],
    })).filter((l) => l.text && l.href)
)

// ── Dump the page's key structural elements ───────────────────────────────────
const structure = await page.evaluate(() => {
    const out = {}

    // Grab first 3 children of body to see overall layout
    out.bodyChildren = Array.from(document.body.children).slice(0, 10).map((el) => ({
        tag: el.tagName,
        id: el.id,
        className: el.className.slice(0, 100),
        innerHTML: el.innerHTML.slice(0, 500),
    }))

    // Try to find a navigation / sidebar element
    const navCandidates = [
        "#leftnav", "#left_nav", "#leftmenu", "#left_menu",
        "#navigation", "#nav", "#sidenav",
        ".leftnav", ".left-nav", ".sidebar", ".navigation",
        "nav", "aside",
    ]
    out.navFound = {}
    for (const sel of navCandidates) {
        const el = document.querySelector(sel)
        if (el) {
            out.navFound[sel] = {
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                text: el.textContent.trim().slice(0, 300),
                links: Array.from(el.querySelectorAll("a")).map((a) => ({
                    text: a.textContent.trim(),
                    href: a.getAttribute("href"),
                })).slice(0, 30),
            }
        }
    }

    // Try to find product elements
    const prodCandidates = [
        ".product", ".product-item", ".product_item", ".productItem",
        ".item", ".prod", ".listing-item",
        "[class*='product']", "[class*='item']",
        "td", "li",
    ]
    out.productSamples = {}
    for (const sel of prodCandidates) {
        const els = document.querySelectorAll(sel)
        if (els.length > 0 && els.length < 200) {
            out.productSamples[sel] = {
                count: els.length,
                sample: els[0]?.outerHTML?.slice(0, 400),
            }
        }
    }

    // Title of the page
    out.title = document.title
    out.h1 = document.querySelector("h1")?.textContent?.trim()
    out.h2s = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent.trim()).slice(0, 10)

    return out
})

const result = { allLinks: allLinks.slice(0, 100), structure }

const outPath = path.join(__dirname, "..", "site-structure.json")
fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8")

console.log(`\n✅ Site structure saved to: ${outPath}`)
console.log(`\n📎 All links found (${allLinks.length}):`)
allLinks.forEach((l) => console.log(`  [${l.parent}] "${l.text}" → ${l.href}`))

console.log("\n🗺️ Navigation elements found:")
for (const [sel, data] of Object.entries(structure.navFound)) {
    console.log(`  ${sel}: ${data.links.length} links`)
    data.links.forEach((l) => console.log(`    - "${l.text}" → ${l.href}`))
}

console.log("\n📦 Product element candidates:")
for (const [sel, data] of Object.entries(structure.productSamples)) {
    console.log(`  ${sel}: ${data.count} elements`)
}

await browser.close()
