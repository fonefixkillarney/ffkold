import express from "express"
import { getAdminMe, loginAdmin, registerAdmin } from "../controllers/adminController.js"
import { protect } from "../middleware/authMiddleware.js"

const router = express.Router()

router.post("/register", registerAdmin)
router.post("/login", loginAdmin)
router.get("/me", protect, getAdminMe)

export default router
