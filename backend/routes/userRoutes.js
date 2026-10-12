import express from "express"
import {
    confirmEmailChange,
    forgotPassword,
    getUserMe,
    googleSignIn,
    loginUser,
    registerUser,
    requestEmailChange,
    resendEmailCode,
    resetPassword,
    updateUserMe,
    verifyEmailCode,
} from "../controllers/userController.js"
import { protect } from "../middleware/authMiddleware.js"
import { unsubscribe } from "../utils/monthlyReminder.js"

const router = express.Router()

// register/login are step 1 (password) and hand back requiresVerification;
// verify is step 2 and is the only route that mints a token.
router.post("/register", registerUser)
router.post("/login", loginUser)
router.post("/verify", verifyEmailCode)
router.post("/resend-code", resendEmailCode)
// The monthly reminder's unsubscribe link (GET) and mail clients' one-click
// unsubscribe (POST). Public — the signed token in the link is the proof.
router.get("/unsubscribe", unsubscribe)
router.post("/unsubscribe", unsubscribe)
// One step: a verified Google ID token is the proof of address, so it signs in
// (creating the account on first use) without the emailed code.
router.post("/google", googleSignIn)

// Password reset is the same two-step shape, on its own pair of code fields so a
// reset code can never be spent on /verify (see models/User.js). Both are public:
// the whole point is that the customer cannot sign in.
// forgot-password answers identically for every address, so it cannot be used to
// discover which emails have accounts.
router.post("/forgot-password", forgotPassword)
router.post("/reset-password", resetPassword)

router.get("/me", protect, getUserMe)
// Settings page: name + notification preferences.
router.patch("/me", protect, updateUserMe)
// Changing the address is two-step like everything else here — the code goes to
// the NEW address and the account only moves once it comes back.
router.post("/email-change", protect, requestEmailChange)
router.post("/email-change/verify", protect, confirmEmailChange)

export default router
