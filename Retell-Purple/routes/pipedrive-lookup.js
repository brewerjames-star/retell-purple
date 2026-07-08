/**
 * pipedrive_lookup- V1
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

// Returns just the UK "subscriber number" digits -- no leading 0, no +44/44
// country code. This is the part that's identical regardless of which format
// a number is written in, so it's what we use to build search variants.
// e.g. "+447123456789" -> "7123456789", "07123456789" -> "7123456789"
function coreDigits(number) {
  let digits = (number || "").replace(/\D/g, ""); // strip +, spaces, everything but digits
  if (digits.startsWith("44") && digits.length > 10) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

// We DON'T use Pipedrive's /persons/search endpoint for phone matching --
// tested and found unreliable, because it appears to match against the raw
// stored string (which may include spaces/brackets/dashes depending on how
// the number was typed) rather than normalized digits. So "+447557514001"
// and a contact saved as "(075) 575-14001" can fail to match via search even
// though they're the same number.
//
// Instead we fetch persons directly and compare fully-normalized digits
// ourselves, which is 100% reliable regardless of stored formatting. Sandbox
// (and most small business Pipedrive accounts) have few enough contacts that
// paging through everyone is fast and cheap.
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

function getOwnerExtensionMap() {
  try {
    return JSON.parse(process.env.OWNER_EXTENSION_MAP || "{}");
  } catch (err) {
    console.error("OWNER_EXTENSION_MAP is not valid JSON:", err.message);
    return {};
  }
}

module.exports = async function pipedriveLookup(req, res) {
  const rawNumber = req.body.phone_number;

  if (!rawNumber) {
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
    existing_order_summary: "",
  };

  try {
    // 1. Search for a person by phone number, trying a few formats.
    const person = await findPersonByPhone(base, token, rawNumber);
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
      // Known person, but no open deal -- route to general enquiries rather
      // than handing the AI a dead end with nowhere to transfer.
      return res.json({
        match_found: true,
        pipedrive_person_id: String(personId),
        contact_name: contactName,
        deal_owner_name: null,
        deal_owner_extension: process.env.GENERAL_ENQUIRIES_NUMBER || null,
        existing_order_summary: "",
      });
    }

    const ownerId = deal.user_id?.id;
    const ownerName = deal.user_id?.name || null;
    const ownerMap = getOwnerExtensionMap();
    const ownerExtension = ownerId ? ownerMap[String(ownerId)] || null : null;
    // Short, natural-language summary the AI can reference when confirming
    // an existing order rather than asking from scratch. Built from fields
    // we already have -- no extra Pipedrive call needed.
    const existingOrderSummary = deal.title || "";

    return res.json({
      match_found: true,
      pipedrive_person_id: String(personId),
      contact_name: contactName,
      deal_owner_name: ownerName,
      deal_owner_extension: ownerExtension || process.env.GENERAL_ENQUIRIES_NUMBER || null,
      existing_order_summary: existingOrderSummary,
    });
  } catch (err) {
    console.error("pipedrive-lookup error:", err);
    return res.status(502).json({ error: "Pipedrive lookup failed", detail: err.message });
  }
};
