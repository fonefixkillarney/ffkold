import express from "express"
import { createPaymentIntent, getPaymentConfig } from "../controllers/paymentController.js"

const router = express.Router()

router.get("/config", getPaymentConfig)
router.post("/create-intent", createPaymentIntent)

export default router
