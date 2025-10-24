import express from "express";
import axios from "axios";
import cors from "cors";
import helmet from "helmet";

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

/* ======================= DeepL ======================= */
const DEEPL_API_KEY  = process.env.DEEPL_API_KEY;
const DEEPL_BASE_URL = process.env.DEEPL_BASE_URL || "https://api-free.deepl.com";

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

/* ======================= ElevenLabs ======================= */

/**
 * Bezpečná verzia by bola len:
 * const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
 *
 * Ty ale chceš natvrdo vložiť svoj kľúč, takže spravíme fallback:
 */
const ELEVEN_API_KEY =
  process.env.ELEVEN_API_KEY ||
  "sk_817adefae6f81d0e49941b773a61e4173c15c4db58439d21";

const ELEVEN_BASE = "https://api.elevenlabs.io";

/**
 * GET /voices
 * Vráti zoznam hlasov, ktoré vieš použiť vo frontendovom selecte.
 */
app.get("/voices", async (_req, res) => {
  try {
    if (!ELEVEN_API_KEY) {
      return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });
    }

    const r = await axios.get(`${ELEVEN_BASE}/v1/voices`, {
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Accept": "application/json"
      },
      timeout: 20000
    });

    // Normalizujeme len na to, čo WP potrebuje (id + meno)
    const simplified = (r.data?.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
      labels: v.labels
    }));

    return res.json(simplified);
  } catch (e) {
    const code = e?.response?.status;
    const data = e?.response?.data;
    console.error("ELEVEN /voices error:", code, data || e.message);
    return res.status(500).json({
      error: "Voices fetch failed",
      details: code || "unknown"
    });
  }
});


/**
 * POST /tts
 * Body: { text: "...", voiceId: "...", model?: "...", voice_settings?: {...} }
 * Návrat: audio/mpeg (binárne MP3)
 */
app.post("/tts", async (req, res) => {
  try {
    if (!ELEVEN_API_KEY) {
      return res.status(500).json({ error: "Missing ELEVEN_API_KEY" });
    }

    const {
      text,
      voiceId,
      model = "eleven_multilingual_v2",
      voice_settings
    } = req.body || {};

    if (!text || !voiceId) {
      return res.status(400).json({ error: "text a voiceId sú povinné" });
    }

    const payload = {
      text,
      model_id: model,
      voice_settings: voice_settings || {
        stability: 0.4,
        similarity_boost: 0.8
      }
    };

    const r = await axios.post(
      `${ELEVEN_BASE}/v1/text-to-speech/${voiceId}`,
      payload,
      {
        headers: {
          "xi-api-key": ELEVEN_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg"
        },
        // dôležité: očakávame binárne audio
        responseType: "arraybuffer",
        timeout: 60000
      }
    );

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    // Buffer.from aby Node neposlal [object Object]
    return res.send(Buffer.from(r.data));
  } catch (e) {
    const code = e?.response?.status;
    console.error("ELEVEN /tts error:", code, e?.response?.data || e.message);
    return res.status(500).json({
      error: "TTS failed",
      details: code || "unknown"
    });
  }
});

/* ======================= Start ======================= */
app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
