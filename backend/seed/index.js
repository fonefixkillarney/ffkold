import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import connectDB from "../db/db.js";
import "../models/index.js";

// Plan pricing/minutes/agent-range/name/paddlePriceId are no longer stored
// in Mongo - they're read straight from be-enterdial/.env at request time
// (see utils/planConfig.js), so there is nothing to seed for plans anymore.

// The super admin is intentionally NOT seeded - they self-register at
// /register (super admin flow) using the email configured in
// SUPER_ADMIN_EMAIL, then verify it with an emailed 6-digit code, exactly
// like an admin does. See registerSuperAdmin in adminAuthController.js.
// No demo admins or agents are seeded either - every admin/agent account is
// created through the real registration/invite flows.

// Available numbers are no longer seeded with mock data - they're synced
// live from Telnyx's available_phone_numbers API on demand (see
// listAvailableNumbers in utils/telephony/telnyx.js). If Telnyx isn't
// configured, or has no inventory for a region, the buy-number page simply
// shows "No numbers found" instead of falling back to fake numbers.

async function run() {
    await connectDB();
    await mongoose.connection.close();
    process.exit(0);
}

run().catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
});
