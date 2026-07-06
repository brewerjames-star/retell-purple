/**
 * pipedrive_add_note
 *
 * Only called when pipedrive_lookup returned a pipedrive_person_id (known
 * caller). For unmatched/new callers, use send_message_email instead. hello
 *
 *
 * Input (from Retell) -- top level, not nested under "args":
 * {
 *   "pipedrive_person_id": "123",
 *   "direction": "inbound",
 *   "summary": "Caller asked about order status, transferred to Tom."
 * }
 *
 * Notes:
 * - call_time is NOT supplied by the agent -- the agent can only guess at
 *   "now" from a template variable, so the server stamps its own timestamp
 *   the moment the request arrives, which is both simpler and more accurate.
 * - recording_url is NOT supplied by the agent either -- it doesn't exist
 *   yet mid-call (Retell only generates it after the call ends). The note
 *   is created without it. If you want the recording attached later, that
 *   needs a genuinely separate post-call webhook (Retell fires this itself
 *   after hangup, with the real recording URL) that PATCHes the note --
 *   a good Phase 1 follow-up, not needed to get testing working now.
 *
 * Output: { "success": true, "note_id": "456" }
 */

module.exports = async function pipedriveAddNote(req, res) {
  const { pipedrive_person_id, direction, summary } = req.body;

  if (!pipedrive_person_id) {
    return res.status(400).json({ error: "pipedrive_person_id is required" });
  }

  const base = process.env.PIPEDRIVE_BASE_URL;
  const token = process.env.PIPEDRIVE_API_TOKEN;

  // Stamped server-side on arrival -- not trusted from the agent.
  const callTime = new Date().toISOString();

  const content = [
    `**AI Receptionist Call Log**`,
    `Time: ${callTime}`,
    `Direction: ${direction || "inbound"}`,
    `Summary: ${summary || "No summary provided."}`,
  ].join("\n");

  try {
    const resp = await fetch(`${base}/notes?api_token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        person_id: Number(pipedrive_person_id),
      }),
    });
    const data = await resp.json();

    if (!resp.ok || !data.success) {
      throw new Error(data.error || `Pipedrive returned ${resp.status}`);
    }

    return res.json({ success: true, note_id: String(data.data.id) });
  } catch (err) {
    console.error("pipedrive-add-note error:", err);
    return res.status(502).json({ error: "Failed to add Pipedrive note", detail: err.message });
  }
};