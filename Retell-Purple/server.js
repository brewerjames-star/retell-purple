require("dotenv").config();
const express = require("express");
const pipedriveLookup = require("./routes/pipedrive-lookup");
const pipedriveAddNote = require("./routes/pipedrive-add-note");
const sendMessageEmail = require("./routes/send-message-email");

const app = express();
app.use(express.json());

// Shared-secret auth: Retell must send this header on every custom function
// call. Configure it in Retell's tool setup under "Headers".
function requireApiKey(req, res, next) {
  const provided = req.header("x-api-key");
  if (!process.env.FUNCTIONS_API_KEY || process.env.FUNCTIONS_API_KEY === "REPLACE-ME-SHARED-SECRET") {
    return res.status(500).json({ error: "Server misconfigured: FUNCTIONS_API_KEY not set" });
  }
  if (provided !== process.env.FUNCTIONS_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.use(requireApiKey);

app.post("/pipedrive-lookup", pipedriveLookup);
app.post("/pipedrive-add-note", pipedriveAddNote);
app.post("/send-message-email", sendMessageEmail);
app.post("/retell-post-call",   require("./routes/retell-post-call"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Purple Retell functions listening on port ${port}`);
});
