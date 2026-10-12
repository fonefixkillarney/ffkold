/**
 * Explore one category page to see product listing structure.
 * node utils/exploreCategory.js
 */

import puppeteer from "puppeteer"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CATEGORY_URL = "https://www.mobigo.ie/category-s/3763.htm" // LCD Screens

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
const page = await browser.newPage()
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")

console.log("Visiting category page:", CATEGORY_URL)
await page.goto(CATEGORY_URL, { waitUntil: "networkidle2", timeout: 60000 })

const info = await page.evaluate(() => {
    const result = {}

    // Try every plausible product container
    const selectors = [
        ".ProductDescCell", ".product-item", ".product-listing", ".ProductMain",
        ".product", ".item", ".listing", "[class*='product']", "[class*='Product']",
        "td", "div.product", "li.product",
        ".span3", ".col-md-3", ".col-sm-4", // Bootstrap grid
        ".ProductName", ".product-name",
    ]
    result.selectorCounts = {}
    for (const sel of selectors) {
        const count = document.querySelectorAll(sel).length
        if (count > 0 && count < 500) result.selectorCounts[sel] = count
    }

    // Get first product HTML for most promising selector
    result.productSamples = {}
    for (const [sel, count] of Object.entries(result.selectorCounts)) {
        if (count >= 2 && count <= 100) {
            result.productSamples[sel] = {
                count,
                html: document.querySelector(sel)?.outerHTML?.slice(0, 1000),
            }
        }
    }

    // Try to get product names, prices, images
    result.productNames = Array.from(document.querySelectorAll(
        ".ProductName a, .product-name a, h2 a, h3 a, [class*='ProductName'] a"
    )).map(a => ({ text: a.textContent.trim(), href: a.getAttribute("href") })).slice(0, 20)

    result.prices = Array.from(document.querySelectorAll(
        ".ProductPrice, .product-price, [class*='Price'], [class*='price']"
    )).map(el => el.textContent.trim()).slice(0, 20)

    result.images = Array.from(document.querySelectorAll(
        ".ProductImage img, .product-image img, [class*='ProductImage'] img"
    )).map(img => img.src || img.getAttribute("data-src")).slice(0, 10)

    // Pagination
    result.pagination = Array.from(document.querySelectorAll(
        ".pager a, .pagination a, [class*='pager'] a, [class*='pagination'] a"
    )).map(a => ({ text: a.textContent.trim(), href: a.getAttribute("href") })).slice(0, 10)

    // Page title
    result.title = document.title

    // Get ALL unique CSS classes on divs and tds to discover patterns
    const allEls = document.querySelectorAll("div, td, li, article")
    const classFreq = {}
    allEls.forEach(el => {
        el.className.split(" ").forEach(c => {
            c = c.trim()
            if (c && c.length > 2) classFreq[c] = (classFreq[c] || 0) + 1
        })
    })
    result.topClasses = Object.entries(classFreq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([cls, cnt]) => `${cls}(${cnt})`)

    return result
})

const outPath = path.join(__dirname, "..", "category-structure.json")
fs.writeFileSync(outPath, JSON.stringify(info, null, 2), "utf8")

console.log("\nPage title:", info.title)
console.log("\nSelector counts:", info.selectorCounts)
console.log("\nProduct names found:", info.productNames)
console.log("\nPrices found:", info.prices)
console.log("\nTop CSS classes:", info.topClasses)
console.log("\nPagination:", info.pagination)
console.log(`\n✅ Full details saved to: ${outPath}`)

await browser.close()
