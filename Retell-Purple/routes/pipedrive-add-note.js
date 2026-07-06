/**
 * pipedrive_add_note
 *
 * Only called when pipedrive_lookup returned a pipedrive_person_id (known
 * caller). For unmatched/new callers, use send_message_email instead.
 *
 * Input (from Retell):
 * {
 *   "pipedrive_person_id": "123",
 *   "call_time": "2026-07-06T14:32:00Z",
 *   "direction": "inbound",
 *   "summary": "Caller asked about order status, transferred to Tom.",
 *   "recording_url": "https://dashboard.retellai.com/recordings/abc123"
 * }
 *
 * Output: { "success": true, "note_id": "456" }
 */

module.exports = async function pipedriveAddNote(req, res) {
  const { pipedrive_person_id, call_time, direction, summary, recording_url } = req.body;

  if (!pipedrive_person_id) {
    return res.status(400).json({ error: "pipedrive_person_id is required" });
  }

  const base = process.env.PIPEDRIVE_BASE_URL;
  const token = process.env.PIPEDRIVE_API_TOKEN;

  const content = [
    `**AI Receptionist Call Log**`,
    `Time: ${call_time || "unknown"}`,
    `Direction: ${direction || "inbound"}`,
    `Summary: ${summary || "No summary provided."}`,
    recording_url ? `Recording: ${recording_url}` : null,
  ]
    .filter(Boolean)
    .join("\n");

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
