/**
 * send_message_email
 *
 * Used for new/unmatched callers (no pipedrive_person_id) whose message
 * should go to a human by email rather than as a Pipedrive note --
 * e.g. a brand-new enquiry or an out-of-hours message from someone not
 * yet in Pipedrive.
 *
 * Input (from Retell):
 * {
 *   "caller_name": "Jane Smith",
 *   "caller_number": "+441234567890",
 *   "reason": "Wants a quote for a granite worktop",
 *   "existing_order": false,
 *   "recipient": "optional override, defaults to NEW_ENQUIRY_EMAIL"
 * }
 *
 * Output: { "success": true }
 *
 * Ships with SendGrid by default. To switch providers, only the body of
 * sendEmail() below needs to change -- the route logic above it stays the same.
 */

async function sendEmail({ to, subject, text }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_ADDRESS;

  const resp = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: "Purple AI Receptionist" },
      subject,
      content: [{ type: "text/plain", value: text }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`SendGrid returned ${resp.status}: ${body}`);
  }
}

module.exports = async function sendMessageEmail(req, res) {
  const { caller_name, caller_number, reason, existing_order, recipient } = req.body;

  if (!caller_number) {
    return res.status(400).json({ error: "caller_number is required" });
  }

  const to = recipient || process.env.NEW_ENQUIRY_EMAIL;
  const subject = `New receptionist message: ${caller_name || "Unknown caller"}`;
  const text = [
    `Name: ${caller_name || "Not given"}`,
    `Number: ${caller_number}`,
    `Existing order?: ${existing_order ? "Yes" : "No / unknown"}`,
    `Reason for call: ${reason || "Not captured"}`,
    ``,
    `Logged automatically by the Purple AI receptionist.`,
  ].join("\n");

  try {
    await sendEmail({ to, subject, text });
    return res.json({ success: true });
  } catch (err) {
    console.error("send-message-email error:", err);
    return res.status(502).json({ error: "Failed to send email", detail: err.message });
  }
};
