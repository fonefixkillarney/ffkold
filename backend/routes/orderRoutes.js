import express from "express"
import { createOrder, deleteOrder, dispatchOrder, getOrderByNumber, getOrders, getPromo, updateOrderStatus, validatePromo } from "../controllers/orderController.js"
import { protect, requireAdmin } from "../middleware/authMiddleware.js"

const router = express.Router()

router.post("/", createOrder)
router.get("/", protect, requireAdmin, getOrders)
router.get("/promo", getPromo)
router.post("/promo/validate", validatePromo)
router.get("/lookup/:orderNumber", getOrderByNumber)
router.patch("/:id/status", protect, requireAdmin, updateOrderStatus)
// Dispatch = attach the courier tracking id + flip to Dispatched in one write.
router.patch("/:id/tracking", protect, requireAdmin, dispatchOrder)
router.delete("/:id", protect, requireAdmin, deleteOrder)

export default router
