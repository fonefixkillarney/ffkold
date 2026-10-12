/**
 * Deep investigation of the category page after login.
 * node utils/testProducts.js
 */

import puppeteer from "puppeteer"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BASE_URL = "https://www.mobigo.ie"

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
const page = await browser.newPage()
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")

// Enable request interception to see API calls
const xhrRequests = []
page.on("response", async (res) => {
    const url = res.url()
    if (url.includes("product") || url.includes("category") || url.includes("json") || url.includes("api")) {
        xhrRequests.push({ url, status: res.status(), type: res.headers()["content-type"] || "" })
    }
})

// LOGIN
await page.goto(`${BASE_URL}/login.asp`, { waitUntil: "networkidle2", timeout: 60000 })
await page.type("input[name='email']", process.env.MOBIGO_EMAIL, { delay: 20 })
await page.type("input[name='password']", process.env.MOBIGO_PASSWORD, { delay: 20 })
await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    page.click("input[name='Login']"),
])
console.log("Logged in. URL:", page.url())

// Visit category page and WAIT longer
await page.goto(`${BASE_URL}/category-s/3763.htm`, { waitUntil: "networkidle2", timeout: 60000 })

// Scroll to trigger any lazy loading
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await new Promise(r => setTimeout(r, 3000))
await page.evaluate(() => window.scrollTo(0, 0))
await new Promise(r => setTimeout(r, 2000))

// Save full HTML
const fullHtml = await page.content()
fs.writeFileSync(path.join(__dirname, "..", "category-after-login.html"), fullHtml, "utf8")
console.log("Full HTML saved to category-after-login.html")

// Investigate what's in the main content area
const info = await page.evaluate(() => {
    // Look for the main content container
    const mainContent = document.querySelector(
        "#content_area, .container--content, main, #main, .main-content, [role='main']"
    )

    // Get ALL div/td/li counts
    const counts = {}
    ;["div", "td", "tr", "li", "article", "section", "table"].forEach(tag => {
        counts[tag] = document.querySelectorAll(tag).length
    })

    // Get all unique IDs
    const ids = Array.from(document.querySelectorAll("[id]")).map(el => el.id).filter(Boolean).slice(0, 50)

    // Try EVERY class that contains a number (product IDs are usually numbers)
    const numberedIds = Array.from(document.querySelectorAll("[id*='product'], [id*='Product'], [id*='item'], [id*='Item']"))
        .map(el => ({ tag: el.tagName, id: el.id, html: el.outerHTML.slice(0, 200) })).slice(0, 10)

    // Get text of the main content area
    const mainText = mainContent?.innerText?.slice(0, 500) || "main content not found"

    // Look for price patterns in the entire page
    const pricePattern = /[€£]\s*\d+[.,]\d{2}/g
    const allText = document.body.innerText
    const pricesFound = allText.match(pricePattern) || []

    // Check for iframe or embedded content
    const iframes = Array.from(document.querySelectorAll("iframe")).map(f => f.src)

    return {
        counts,
        mainContentFound: !!mainContent,
        mainContentClass: mainContent?.className,
        mainText,
        pricesFound: pricesFound.slice(0, 20),
        iframes,
        ids: ids.slice(0, 40),
        numberedIds,
    }
})

console.log("\n=== Page analysis ===")
console.log("Tag counts:", info.counts)
console.log("Main content found:", info.mainContentFound, "(class:", info.mainContentClass + ")")
console.log("Main content text:", info.mainText)
console.log("Prices found:", info.pricesFound)
console.log("Iframes:", info.iframes)
console.log("\nAll IDs (first 40):", info.ids)
console.log("\nNumbered element IDs:", info.numberedIds)
console.log("\nXHR requests intercepted:", xhrRequests)

await browser.close()
console.log("\nDone. Check category-after-login.html for full page source.")
