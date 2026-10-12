/**
 * Preview / test the monthly reminder without waiting for the 1st.
 *
 *   node utils/sendMonthlyReminder.js                  # how many customers would get it
 *   node utils/sendMonthlyReminder.js --to=you@x.com   # send ONE copy to that address
 *
 * The real monthly send is automatic (utils/monthlyReminder.js, started by
 * server.js); this script never sends to the customer list.
 */
import dotenv from "dotenv"
dotenv.config()

import mongoose from "mongoose"
import { sendMonthlyReminderEmails } from "./mailer.js"
import { reminderRecipients, unsubscribeUrlFor } from "./monthlyReminder.js"

const to = process.argv.find((a) => a.startsWith("--to="))?.slice("--to=".length)

await mongoose.connect(process.env.MONGO_URI)
const recipients = await reminderRecipients()
console.log(`${recipients.length} customer(s) would receive the next monthly reminder`)

if (to) {
    const email = to.toLowerCase().trim()
    const result = await sendMonthlyReminderEmails([{ email, name: "", unsubscribeUrl: unsubscribeUrlFor(email) }])
    console.log(result.sent ? `test email sent to ${email}` : `test email NOT sent (${result.reason || "see error above"})`)
}
await mongoose.disconnect()
