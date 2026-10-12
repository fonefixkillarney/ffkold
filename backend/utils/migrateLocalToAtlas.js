/**
 * One-off migration — copies products/categories/banners from local MongoDB
 * into Atlas, so you don't have to re-scrape mobigo.ie to populate Atlas.
 *
 * Run directly from terminal:
 *   node utils/migrateLocalToAtlas.js
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"

const LOCAL_URI = process.env.LOCAL_MONGO_URI
const ATLAS_URI = process.env.ATLAS_MONGO_URI

if (!LOCAL_URI || !ATLAS_URI) {
    console.error("❌ Set LOCAL_MONGO_URI and ATLAS_MONGO_URI in .env")
    process.exit(1)
}

const COLLECTIONS = ["products", "categories", "banners"]

async function main() {
    console.log("Connecting to local MongoDB...")
    const local = await mongoose.createConnection(LOCAL_URI).asPromise()
    console.log("Connecting to Atlas...")
    const atlas = await mongoose.createConnection(ATLAS_URI).asPromise()

    try {
        for (const name of COLLECTIONS) {
            const docs = await local.db.collection(name).find().toArray()
            console.log(`\n[${name}] ${docs.length} docs found locally`)
            if (!docs.length) continue

            await atlas.db.collection(name).deleteMany({})
            await atlas.db.collection(name).insertMany(docs)
            console.log(`[${name}] ✅ copied ${docs.length} docs to Atlas`)
        }
        console.log("\nDone. Point MONGO_URI at ATLAS_MONGO_URI and restart the server.")
    } finally {
        await local.close()
        await atlas.close()
    }
}

main().catch((err) => {
    console.error("\n❌ Migration failed:", err.message)
    process.exit(1)
})
