import express from "express";
import axios from "axios";
import cors from "cors";
import helmet from "helmet";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

/* ============== DeepL (POZOR: hardcoded key – nepushuj verejne) ============== */
const DEEPL_API_KEY = "09009672-d794-48b4-b378-a50b51275261:fx"; // ⚠️ len na test lokálne
const DEEPL_BASE_URL = "https://api-free.deepl.com";

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/translate", async (req, res) => {
  try {
    const { text, targetLang, sourceLang } = req.body || {};
    if (!text || !targetLang) {
      return res.status(400).json({ error: "Chýba text alebo targetLang" });
    }

    const params = new URLSearchParams();
    params.append("text", text);
    params.append("target_lang", String(targetLang).toUpperCase());
    if (sourceLang) params.append("source_lang", String(sourceLang).toUpperCase());

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

    return res.json({ translatedText: r.data?.translations?.[0]?.text ?? "" });
  } catch (err) {
    console.error(err?.response?.data || err.message);
    return res.status(500).json({ error: "Server chyba" });
  }
});

/* ======================= ElevenLabs TTS (POZOR: key) ======================== */
// ⚠️ Na ostro radšej použij: const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVEN_API_KEY = "5734c1ecea86d866397b17847e30b4057e971ead9fb7864f4c25bbbc01d42c35"; // len dočasne
const ELEVEN_BASE = "https://api.elevenlabs.io";

// Zoznam hlasov
app.get("/voices", async (_req, res) => {
  try {
    if (!ELEVEN_API_KEY) return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });

    const r = await axios.get(`${ELEVEN_BASE}/v1/voices`, {
      headers: { "xi-api-key": ELEVEN_API_KEY },
      timeout: 15000
    });

    res.json(r.data?.voices || []);
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).json({ error: "Voices fetch failed" });
  }
});

// TTS – vráti MP3 (binary)
app.post("/tts", async (req, res) => {
  try {
    if (!ELEVEN_API_KEY) return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });

    const { text, voiceId, model = "eleven_multilingual_v2", voice_settings } = req.body || {};
    if (!text || !voiceId) return res.status(400).json({ error: "text a voiceId sú povinné" });

    const payload = {
      text,
      model_id: model,
      voice_settings: voice_settings || { stability: 0.4, similarity_boost: 0.8 }
    };

    const r = await axios.post(`${ELEVEN_BASE}/v1/text-to-speech/${voiceId}`, payload, {
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      responseType: "arraybuffer",
      timeout: 60000
    });

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    res.send(Buffer.from(r.data));
  } catch (e) {
    console.error(e?.response?.data || e.message);
    res.status(500).json({ error: "TTS failed" });
  }
});

/* ============================== Start server =============================== */
app.listen(PORT, () => console.log(`🚀 DeepL/Eleven gateway running on port ${PORT}`));
