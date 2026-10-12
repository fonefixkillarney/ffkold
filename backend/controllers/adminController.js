import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { Admin } from "../models/Admin.js"

const TOKEN_EXPIRY = "7d"

function signAdminToken(admin) {
    return jwt.sign(
        { id: admin._id, email: admin.email, role: admin.role || "admin" },
        process.env.JWT_SECRET,
        { expiresIn: TOKEN_EXPIRY }
    )
}

// POST /api/admin/register — bootstrap only, succeeds exactly once (before any Admin
// document exists). Normal provisioning happens via seedAdminFromEnv() at server startup;
// this stays only as a documented fallback, not an open account-creation endpoint.
export const registerAdmin = async (req, res) => {
    try {
        const existing = await Admin.countDocuments()
        if (existing > 0) {
            return res.status(403).json({ success: false, message: "An admin account already exists" })
        }

        const { email, password } = req.body
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "email and password are required" })
        }

        const hashed = await bcrypt.hash(password, 10)
        const admin = await Admin.create({ email: email.toLowerCase().trim(), password: hashed })
        res.status(201).json({ success: true, token: signAdminToken(admin), data: { id: admin._id, email: admin.email, role: admin.role || "admin" } })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export const loginAdmin = async (req, res) => {
    try {
        const { email, password } = req.body
        if (!email || !password) {
            return res.status(400).json({ success: false, message: "email and password are required" })
        }

        const admin = await Admin.findOne({ email: email.toLowerCase().trim() })
        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return res.status(401).json({ success: false, message: "Invalid email or password" })
        }

        res.status(200).json({ success: true, token: signAdminToken(admin), data: { id: admin._id, email: admin.email, role: admin.role || "admin" } })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}

export const getAdminMe = async (req, res) => {
    try {
        const admin = await Admin.findById(req.user.id).select("-password").lean()
        if (!admin) return res.status(404).json({ success: false, message: "Admin not found" })
        // .lean() skips schema defaults, so accounts created before the role field
        // existed would come back without one — normalize it for the client.
        res.status(200).json({ success: true, data: { ...admin, role: admin.role || "admin" } })
    } catch (error) {
        res.status(500).json({ success: false, message: error.message })
    }
}
