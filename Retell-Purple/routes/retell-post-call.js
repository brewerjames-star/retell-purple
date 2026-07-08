/**
 * retell_post_call  (POST /retell-post-call) 
 *
 * Retell fires this webhook ITSELF after a call, so it's the one place where
 * the recording URL actually exists. It replaces the mid-call pipedrive_add_note
 * tool: it looks the caller up by phone number, then writes ONE note to their
 * Pipedrive timeline containing the time, direction, Retell's call summary, and
 * the recording link.
 *
 * We only act on the `call_analyzed` event (the last one Retell sends, once the
 * summary is ready). `call_started` / `call_ended` are acknowledged and ignored.
 *
 * AUTH: Retell can't send our usual x-api-key header, so protect this endpoint
 * with a secret in the URL. Register the webhook in Retell as:
 *     https://<your-railway-url>/retell-post-call?token=<FUNCTIONS_API_KEY>
 * (Optional hardening: also allowlist Retell's IP 100.20.5.228, and/or switch
 *  to proper x-retell-signature verification — see notes at the bottom.)
 *
 * IMPORTANT: In Retell, keep "Opt-Out of Personal and Sensitive Data Storage"
 * OFF. If it's ON, recording_url expires after 10 minutes and the saved link
 * will be dead.
 *
 * Retell webhook expects a 2xx quickly (10s timeout, up to 3 retries), so this
 * returns fast and is idempotent per call_id.
 */

// Best-effort in-memory dedup (resets on redeploy — fine at this volume; Pipedrive
// retries would otherwise create duplicate notes if our response is slow).
const processed = new Set();

// Same matching approach as pipedrive-lookup.js: normalize to core digits
// (no leading 0, no +44/44) and compare against every contact directly,
// rather than relying on Pipedrive's /persons/search -- tested and found
// unreliable, since it appears to match raw stored text (which may include
// spaces/brackets/dashes) rather than normalized digits.
function coreDigits(number) {
  let digits = (number || "").replace(/\D/g, "");
  if (digits.startsWith("44") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

async function findPersonByPhone(base, token, rawNumber) {
  const target = coreDigits(rawNumber);
  if (!target) return null;

  let start = 0;
  const limit = 500;

  while (true) {
    const url = `${base}/persons?start=${start}&limit=${limit}&api_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();
    const items = data?.data || [];

    for (const person of items) {
      const phones = Array.isArray(person.phone)
        ? person.phone
        : person.phone
        ? [{ value: person.phone }]
        : [];
      for (const p of phones) {
        if (p?.value && coreDigits(p.value) === target) {
          return person;
        }
      }
    }

    const more = data?.additional_data?.pagination?.more_items_in_collection;
    if (!more) break;
    start += limit;
  }

  return null;
}

module.exports = async function retellPostCall(req, res) {
  // --- 1. Auth via URL token ---
  const expected = process.env.FUNCTIONS_API_KEY;
  if (!expected || req.query.token !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { event, call } = req.body || {};

  // --- 2. Only handle the final analyzed event; ack everything else ---
  if (event !== "call_analyzed" || !call) {
    return res.status(204).send();
  }

  // Acknowledge Retell immediately, then do the work. Avoids the 10s timeout /
  // retry loop that would otherwise duplicate notes.
  res.status(204).send();

  try {
    const callId = call.call_id;
    if (callId && processed.has(callId)) return; // already handled
    if (callId) processed.add(callId);

    // Customer number = the far end. Inbound: from_number. Outbound: to_number.
    const direction = call.direction || "inbound";
    const phone = direction === "outbound" ? call.to_number : call.from_number;
    if (!phone) {
      console.warn("post-call: no phone number on call", callId);
      return;
    }

    const base = process.env.PIPEDRIVE_BASE_URL;
    const token = process.env.PIPEDRIVE_API_TOKEN;

    // --- 3. Find the Pipedrive person by phone (tries a few number formats) ---
    const person = await findPersonByPhone(base, token, phone);
    const personId = person?.id;

    if (!personId) {
      // New / unknown caller — they were already emailed mid-call via
      // send_message_email, so there's no Pipedrive timeline to write to.
      console.log("post-call: no Pipedrive match for", phone, "- skipping note");
      return;
    }

    // --- 4. Build the note ---
    const callTime = new Date(
      call.start_timestamp || Date.now()
    ).toISOString();
    const summary =
      call.call_analysis?.call_summary || "No summary generated.";
    const recording = call.recording_url;

    const content = [
      `**AI Receptionist Call Log**`,
      `Time: ${callTime}`,
      `Direction: ${direction}`,
      `Summary: ${summary}`,
      recording ? `Recording: ${recording}` : `Recording: (not available)`,
    ].join("\n");

    // --- 5. Write it to the timeline ---
    const noteResp = await fetch(`${base}/notes?api_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, person_id: Number(personId) }),
    });
    const noteData = await noteResp.json();

    if (!noteResp.ok || !noteData.success) {
      throw new Error(noteData.error || `Pipedrive returned ${noteResp.status}`);
    }
    console.log("post-call: note", noteData.data.id, "added for person", personId);
  } catch (err) {
    // We've already 204'd, so just log — Retell won't retry a 2xx.
    console.error("retell-post-call error:", err);
  }
};

/*
 * ── Optional upgrade: proper signature verification ───────────────────────────
 * Stronger than the URL token. Requires the raw request body, so in your server
 * file capture it when parsing JSON:
 *     app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
 * then near the top of this handler:
 *     const { Retell } = require("retell-sdk");
 *     const ok = Retell.verify(req.rawBody.toString("utf-8"),
 *                              process.env.RETELL_API_KEY,
 *                              req.headers["x-retell-signature"]);
 *     if (!ok) return res.status(401).json({ error: "Bad signature" });
 * (npm i retell-sdk, and add RETELL_API_KEY to Railway.)
 */