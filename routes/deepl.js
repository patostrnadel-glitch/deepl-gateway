import express from "express";
import axios from "axios";

const router = express.Router();

const DEEPL_API_KEY  = process.env.DEEPL_API_KEY;
const DEEPL_BASE_URL = process.env.DEEPL_BASE_URL || "https://api-free.deepl.com";

/**
 * POST /translate
 * Body:
 * {
 *   "text": "Ahoj svet",
 *   "targetLang": "EN",
 *   "sourceLang": "SK" (optional)
 * }
 */
router.post("/translate", async (req, res) => {
  try {
    const { text, targetLang, sourceLang } = req.body || {};
    if (!text || !targetLang) {
      return res.status(400).json({ error: "Chýba text alebo targetLang" });
    }

    const params = new URLSearchParams();
    params.append("text", text);
    params.append("target_lang", String(targetLang).toUpperCase());
    if (sourceLang) {
      params.append("source_lang", String(sourceLang).toUpperCase());
    }

    const r = await axios.post(
      `${DEEPL_BASE_URL}/v2/translate`,
      params,
      {
        headers: {
          "Authorization": `DeepL-Auth-Key ${DEEPL_API_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        timeout: 15000
      }
    );

    return res.json({
      translatedText: r.data?.translations?.[0]?.text ?? ""
    });
  } catch (e) {
    console.error("DEEPL /translate error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "Server chyba" });
  }
});

export default router;
