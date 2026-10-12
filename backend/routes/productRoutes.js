import express from "express"
import {
    getProducts,
    scrapeAndSaveProducts,
    getScrapeStatus,
    getSavedProducts,
    getSingleProduct,
    updateProductPrice,
    updateProductStock,
    getCategories,
    getBanners,
    getPendingItems,
    approveProduct,
    approveBanner,
    deleteProduct,
} from "../controllers/productController.js"
import { protect, attachUser, requireAdmin } from "../middleware/authMiddleware.js"

const router = express.Router()

router.get("/scrape", protect, requireAdmin, getProducts)
router.get("/scrape-save", protect, requireAdmin, scrapeAndSaveProducts)
router.get("/scrape-status", getScrapeStatus)
router.get("/products", getSavedProducts)
// attachUser, not protect: the route stays public, but an admin token (when one
// is sent) is what lets the admin preview a not-yet-approved product.
router.get("/products/:id", attachUser, getSingleProduct)
router.patch("/products/:id/price", protect, requireAdmin, updateProductPrice)
router.patch("/products/:id/stock", protect, requireAdmin, updateProductStock)
router.get("/categories", getCategories)
router.get("/banners", getBanners)

// The approval queue, now part of the store owner's own panel at
// /admin/upcoming-products (it used to be a separate very-admin-only page).
router.get("/pending", protect, requireAdmin, getPendingItems)
router.patch("/products/:id/approve", protect, requireAdmin, approveProduct)
router.patch("/banners/:id/approve", protect, requireAdmin, approveBanner)

// Deleting a product is permanent — the controller writes a tombstone so no
// rescrape restores it.
router.delete("/products/:id", protect, requireAdmin, deleteProduct)

export default router
