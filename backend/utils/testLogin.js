/**
 * Quick login test — verifies credentials work and checks what products look like.
 * node utils/testLogin.js
 */

import puppeteer from "puppeteer"
import dotenv from "dotenv"
dotenv.config()

const BASE_URL = "https://www.mobigo.ie"
const EMAIL = process.env.MOBIGO_EMAIL
const PASSWORD = process.env.MOBIGO_PASSWORD

console.log("Testing login for:", EMAIL)

const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
const page = await browser.newPage()
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")

// LOGIN
await page.goto(`${BASE_URL}/login.asp`, { waitUntil: "networkidle2", timeout: 60000 })
await page.waitForSelector("input[name='email']", { timeout: 15000 })

await page.click("input[name='email']", { clickCount: 3 })
await page.type("input[name='email']", EMAIL, { delay: 30 })
await page.click("input[name='password']", { clickCount: 3 })
await page.type("input[name='password']", PASSWORD, { delay: 30 })

await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    page.click("input[name='Login']"),
])

const afterUrl = page.url()
const afterTitle = await page.title()
console.log("\nAfter login:")
console.log("  URL:", afterUrl)
console.log("  Title:", afterTitle.slice(0, 60))

const isOnRegister = afterUrl.includes("Register")
const isOnLogin = afterUrl.includes("login")
if (isOnRegister || isOnLogin) {
    console.log("\n❌ Login FAILED — still on login/register page")
    console.log("   Check your email & password in .env")
    await browser.close()
    process.exit(1)
}

console.log("\n✅ Login appears successful! Checking category page...")

// TEST CATEGORY PAGE
await page.goto(`${BASE_URL}/category-s/3763.htm`, { waitUntil: "networkidle2", timeout: 60000 })
const catInfo = await page.evaluate(() => {
    const priceEls = document.querySelectorAll(".ProductPrice, [class*='Price']")
    const nameLinks = document.querySelectorAll(".ProductName a, [class*='ProductName'] a")
    const prodCells = document.querySelectorAll(".ProductDescCell")
    return {
        url: window.location.href,
        title: document.title.slice(0, 60),
        productDescCells: prodCells.length,
        productNameLinks: nameLinks.length,
        priceElements: priceEls.length,
        sampleName: nameLinks[0]?.textContent?.trim(),
        samplePrice: priceEls[0]?.textContent?.trim(),
        sampleHtml: prodCells[0]?.outerHTML?.slice(0, 400),
        bodyText: document.body.innerText.slice(0, 200),
    }
})

console.log("\nCategory page info:")
console.log("  URL:", catInfo.url)
console.log("  ProductDescCell count:", catInfo.productDescCells)
console.log("  ProductName links:", catInfo.productNameLinks)
console.log("  Price elements:", catInfo.priceElements)
console.log("  Sample product name:", catInfo.sampleName)
console.log("  Sample price:", catInfo.samplePrice)
console.log("\n  Body text preview:")
console.log(" ", catInfo.bodyText)
if (catInfo.sampleHtml) {
    console.log("\n  Sample product HTML:")
    console.log(" ", catInfo.sampleHtml)
}

await browser.close()
