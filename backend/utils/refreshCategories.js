/**
 * Refresh ONLY the sidebar/category tree from mobigo.ie — run from terminal:
 *   node utils/refreshCategories.js
 *
 * A full `scrapeNow` re-crawls ~6000 products and takes hours; the navigation is
 * a single page load plus the deep-expansion pass (a few hundred short category
 * page loads, minutes not hours). Use this whenever the source site's sidebar
 * changes (new menu section, renamed heading, reordered categories, a new phone
 * model added under a series) or after a fix to scrapeNavigation, without
 * touching a single product document.
 *
 * Products are untouched, so admin price overrides are never at risk. Note that
 * a category which only appears here still lists nothing until a scrape has
 * crawled it for products — run `node utils/scrapeNow.js` (or let the server's
 * background scrape do it) for that.
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import puppeteer from "puppeteer"
import { scrapeNavigation, expandCategoryTree, login } from "./srapper.js"
import { Category } from "../models/Category.js"
import { saveCategories } from "./scrapePersistence.js"

await mongoose.connect(process.env.MONGO_URI)
console.log("MongoDB connected.")

const before = await Category.countDocuments()
console.log(`Existing categories: ${before}`)

const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] })
let exitCode = 0
try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900 })
    // The nav itself is public, but the deep pass reads hundreds of category pages
    // — authenticate when credentials are configured so it sees exactly what the
    // trade account sees.
    if (process.env.MOBIGO_EMAIL && process.env.MOBIGO_PASSWORD) {
        await login(page)
    }
    const { categories } = await scrapeNavigation(page)
    // Levels 4-6, which the source sidebar never renders. This also prunes any
    // node on the blocklist, so a removed category cannot reappear here either.
    await expandCategoryTree(browser, categories)

    await saveCategories(categories)

    const countNodes = (items = []) => items.reduce((n, i) => n + 1 + countNodes(i.items), 0)
    // Levels below this list, so an empty list is 0 and the top-level array is 1.
    const depthOf = (items = []) => (items.length ? 1 + Math.max(...items.map((i) => depthOf(i.items))) : 0)
    const total = categories.reduce((n, c) => n + 1 + countNodes(c.items), 0)
    const levels = categories.length ? 1 + Math.max(...categories.map((c) => depthOf(c.items))) : 0
    console.log(`\n✅ Saved ${categories.length} categories (was ${before}) — ${total} nodes, ${levels} levels deep\n`)

    let lastGroup = null
    categories.forEach((c) => {
        if (c.group !== lastGroup) {
            console.log(`\n── ${c.group || "(no heading)"} ──`)
            lastGroup = c.group
        }
        const nodes = countNodes(c.items)
        console.log(`   ${String(c.order).padStart(3)}  ${c.name}${nodes ? `  (${c.items.length} sub, ${nodes} nodes)` : ""}`)
    })
} catch (err) {
    console.error("\n❌ Category refresh failed:", err.message)
    exitCode = 1
} finally {
    await browser.close()
    await mongoose.disconnect()
    process.exit(exitCode)
}
