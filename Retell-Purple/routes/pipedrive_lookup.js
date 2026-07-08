/**
 * pipedrive_lookup
 *
 * Input (from Retell):  { "phone_number": "+441234567890" }
 *
 * Output:
 * {
 *   "match_found": true,
 *   "pipedrive_person_id": "123",
 *   "contact_name": "Jane Smith",
 *   "deal_owner_name": "Tom Owner",
 *   "deal_owner_extension": "+441234500001"
 * }
 * or, if nothing matches:
 * {
 *   "match_found": false,
 *   "pipedrive_person_id": null,
 *   "contact_name": null,
 *   "deal_owner_name": null,
 *   "deal_owner_extension": null
 * }
 */

function normalizePhone(number) {
  if (!number) return "";
  // Strip everything except leading + and digits.
  return number.replace(/[^\d+]/g, "");
}

function getOwnerExtensionMap() {
  try {
    return JSON.parse(process.env.OWNER_EXTENSION_MAP || "{}");
  } catch (err) {
    console.error("OWNER_EXTENSION_MAP is not valid JSON:", err.message);
    return {};
  }
}

module.exports = async function pipedriveLookup(req, res) {
  const callerNumber = normalizePhone(req.body.phone_number);

  if (!callerNumber) {
    return res.status(400).json({ error: "phone_number is required" });
  }

  const base = process.env.PIPEDRIVE_BASE_URL;
  const token = process.env.PIPEDRIVE_API_TOKEN;

  const empty = {
    match_found: false,
    pipedrive_person_id: null,
    contact_name: null,
    deal_owner_name: null,
    deal_owner_extension: null,
  };

  try {
    // 1. Search for a person by phone number.
    const searchUrl = `${base}/persons/search?term=${encodeURIComponent(callerNumber)}&fields=phone&exact_match=false&api_token=${token}`;
    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    const person = searchData?.data?.items?.[0]?.item;
    if (!person) {
      return res.json(empty);
    }

    const personId = person.id;
    const contactName = person.name || null;

    // 2. Find that person's most recent open deal, to identify the deal owner.
    const dealsUrl = `${base}/persons/${personId}/deals?status=open&api_token=${token}`;
    const dealsResp = await fetch(dealsUrl);
    const dealsData = await dealsResp.json();

    const deal = dealsData?.data?.[0];
    if (!deal) {
      // Known person, but no open deal -- still a match, just no owner to route to.
      return res.json({
        ...empty,
        match_found: true,
        pipedrive_person_id: String(personId),
        contact_name: contactName,
      });
    }

    const ownerId = deal.user_id?.id;
    const ownerName = deal.user_id?.name || null;
    const ownerMap = getOwnerExtensionMap();
    const ownerExtension = ownerId ? ownerMap[String(ownerId)] || null : null;

    return res.json({
      match_found: true,
      pipedrive_person_id: String(personId),
      contact_name: contactName,
      deal_owner_name: ownerName,
      deal_owner_extension: ownerExtension || process.env.GENERAL_ENQUIRIES_NUMBER || null,
    });
  } catch (err) {
    console.error("pipedrive-lookup error:", err);
    return res.status(502).json({ error: "Pipedrive lookup failed", detail: err.message });
  }
};

