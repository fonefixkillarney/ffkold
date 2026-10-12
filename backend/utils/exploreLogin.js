/**
 * Explore mobigo.ie login form structure + test login.
 * node utils/exploreLogin.js
 */

import puppeteer from "puppeteer"
import dotenv from "dotenv"
dotenv.config()

const EMAIL = process.env.MOBIGO_EMAIL
const PASSWORD = process.env.MOBIGO_PASSWORD
const BASE_URL = "https://www.mobigo.ie"

const browser = await puppeteer.launch({
    headless: false, // visible so we can see what happens
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
})
const page = await browser.newPage()
await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36")

// Try to find the login page
const loginUrls = [
    `${BASE_URL}/login.asp`,
    `${BASE_URL}/Account.asp`,
    `${BASE_URL}/account.asp`,
    `${BASE_URL}/Register.asp`,
]

for (const url of loginUrls) {
    console.log(`\nTrying: ${url}`)
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })
    const info = await page.evaluate(() => {
        const forms = Array.from(document.querySelectorAll("form")).map(f => ({
            action: f.getAttribute("action"),
            method: f.getAttribute("method"),
            inputs: Array.from(f.querySelectorAll("input, select, textarea")).map(i => ({
                type: i.type,
                name: i.name || i.id,
                placeholder: i.placeholder,
                value: i.type === "password" ? "[hidden]" : i.value?.slice(0, 50),
            })),
        }))
        return { title: document.title.slice(0, 80), forms }
    })
    console.log("Title:", info.title)
    console.log("Forms:", JSON.stringify(info.forms, null, 2))

    // Look for an email + password form
    const hasLogin = info.forms.some(f =>
        f.inputs.some(i => i.type === "password")
    )
    if (hasLogin) {
        console.log("\n✅ Found login form at:", url)

        // Try to login
        const emailInput = await page.$("input[name='Email'], input[type='email'], #Email, #email, input[name='username'], input[name='login']")
        const passInput = await page.$("input[name='Password'], input[type='password'], #Password, #password")

        if (emailInput && passInput) {
            console.log("\nAttempting login...")
            await emailInput.click({ clickCount: 3 })
            await emailInput.type(EMAIL)
            await passInput.click({ clickCount: 3 })
            await passInput.type(PASSWORD)

            // Take screenshot before submit
            await page.screenshot({ path: "login-before.png" })

            await Promise.all([
                page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => { }),
                page.keyboard.press("Enter"),
            ])

            await page.screenshot({ path: "login-after.png" })
            const afterTitle = await page.title()
            const afterUrl = page.url()
            console.log("After login title:", afterTitle)
            console.log("After login URL:", afterUrl)

            // Try visiting a category page
            await page.goto(`${BASE_URL}/category-s/3763.htm`, { waitUntil: "networkidle2", timeout: 30000 })
            const catInfo = await page.evaluate(() => ({
                title: document.title.slice(0, 80),
                hasProducts: !!document.querySelector(".ProductDescCell, .product-item, .ProductName"),
                productCells: document.querySelectorAll(".ProductDescCell").length,
                sampleHtml: document.querySelector(".ProductDescCell, .product-listing, .ProductName")?.outerHTML?.slice(0, 500),
            }))
            console.log("\nCategory page after login:")
            console.log(JSON.stringify(catInfo, null, 2))
        }
        break
    }
}

await browser.close()
