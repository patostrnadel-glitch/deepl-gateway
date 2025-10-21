import express from "express";
import axios from "axios";
import cors from "cors";
import helmet from "helmet";

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// ⚠️ Len pre lokálne testovanie! Neuploaduj na GitHub!
const DEEPL_API_KEY = "09009672-d794-48b4-b378-a50b51275261:fx";
const DEEPL_BASE_URL = "https://api-free.deepl.com";

app.get("/health", (_, res) => res.json({ ok: true }));

app.post("/translate", async (req, res) => {
  try {
    const { text, targetLang, sourceLang } = req.body || {};
    if (!text || !targetLang)
      return res.status(400).json({ error: "Chýba text alebo targetLang" });

    const params = new URLSearchParams();
    params.append("text", text);
    params.append("target_lang", targetLang.toUpperCase());
    if (sourceLang) params.append("source_lang", sourceLang.toUpperCase());

    const r = await axios.post(`${DEEPL_BASE_URL}/v2/translate`, params, {
      headers: {
        "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      timeout: 15000
    });

    return res.json({ translatedText: r.data?.translations?.[0]?.text ?? "" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server chyba" });
  }
});

app.listen(PORT, () => console.log(`🚀 DeepL Gateway running on port ${PORT}`));
