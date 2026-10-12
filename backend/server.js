import dotenv from "dotenv"
dotenv.config();

import express from "express"
import mongoose from "mongoose"
import cors from "cors"
import compression from "compression"
import productRoutes from "./routes/productRoutes.js"
import adminRoutes from "./routes/adminRoutes.js"
import userRoutes from "./routes/userRoutes.js"
import orderRoutes from "./routes/orderRoutes.js"
import paymentRoutes from "./routes/paymentRoutes.js"
import { seedAdminFromEnv, seedVeryAdminFromEnv } from "./utils/seedAdmin.js"
import { backfillApproval } from "./utils/backfillApproval.js"
import { scheduleNextScrape } from "./controllers/productController.js"
import { scheduleMonthlyReminder } from "./utils/monthlyReminder.js"

const app = express();

const corsOptions = {
    origin: ["http://localhost:3000", process.env.CLIENT_URL],
}

app.use(cors(corsOptions));
// The catalogue is by far the biggest thing this server sends — every visitor
// downloads the whole approved product list before a single product can render,
// and it is ~5.6MB of JSON. That JSON is enormously repetitive (the same category
// paths, brands and CDN prefixes over and over), so gzip takes it to ~400KB: a
// 13.8x reduction, measured on the live catalogue. Registered before the routes so
// it covers every response, and it only kicks in above compression's own size
// threshold, leaving small replies alone.
app.use(compression());
app.use(express.json());

try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB Connected:", mongoose.connection.host);
    if (process.env.COMBINED_ALLOW_STARTUP_WRITES === "true") {
        await seedAdminFromEnv();
        await seedVeryAdminFromEnv();
    // Must run before the first scrape can add unapproved products, so the
    // "no approved field yet" rule only ever matches pre-gate documents.
        await backfillApproval();
    } else {
        console.log("Startup admin synchronization and approval backfill disabled");
    }
} catch (err) {
    console.error("MongoDB startup failed:", err.message);
    process.exit(1);
}


app.get("/api/health", (req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ ok: connected });
});
app.use("/api/admin", adminRoutes);
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api", productRoutes);
app.get("/", (req, res) => {
    res.send("Server Working")
})


const PORT = process.env.PORT || 5000;

// On a nodemon restart, the previous process can still be releasing the port
// when this one binds — express's default app.listen has no error handler, so
// that race used to surface as an unhandled 'error' event that killed the whole
// process outright. Retrying a few times gives the old socket time to close.
function startServer(retriesLeft = 5) {
    const server = app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        // The scrape itself is triggered from getSavedProducts (productController.js)
        // the moment the frontend's first GET /api/products has been served — not
        // here at boot. Starting it here used to race that very first DB read
        // against the scraper's own bulkWrite traffic, stalling the frontend's
        // initial load on Atlas contention (measured 210s for a plain
        // Product.find({}) while a scrape was mid-run).
        //
        // Fallback for a server nobody visits: without a first request the
        // deferred scrape never fires, so book one for a full interval from now.
        // If a visitor starts a run first, that run cancels this and re-books
        // the next one itself when it ends — every 2h after the last run
        // finishes (SCRAPE_INTERVAL_HOURS).
        scheduleNextScrape();
        // Monthly "new products" email to past customers (utils/monthlyReminder.js).
        scheduleMonthlyReminder();
    });

    server.on("error", (err) => {
        if (err.code === "EADDRINUSE" && retriesLeft > 0) {
            console.warn(`Port ${PORT} still in use (previous instance shutting down?) — retrying in 1s... (${retriesLeft} left)`);
            setTimeout(() => startServer(retriesLeft - 1), 1000);
        } else {
            console.error("Failed to start server:", err.message);
            process.exit(1);
        }
    });
}

startServer();
