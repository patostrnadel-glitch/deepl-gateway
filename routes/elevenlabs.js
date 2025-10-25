import express from "express";
import axios from "axios";

const router = express.Router();

const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;
const ELEVEN_BASE    = "https://api.elevenlabs.io";

/**
 * GET /voices
 * (Načítanie hlasov z ElevenLabs)
 */
router.get("/voices", async (_req, res) => {
  try {
    if (!ELEVEN_API_KEY) {
      return res.status(500).json({
        error: "Missing ELEVEN_API_KEY on server",
        hint: "Nastav ELEVEN_API_KEY v Render → Environment Variables."
      });
    }

    const r = await axios.get(`${ELEVEN_BASE}/v1/voices`, {
      headers: {
        "xi-api-key": ELEVEN_API_KEY,
        "Accept": "application/json"
      },
      timeout: 20000
    });

    const simplified = (r.data?.voices || []).map(v => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category ?? null,
      labels: v.labels ?? null
    }));

    return res.json(simplified);
  } catch (e) {
    const code = e?.response?.status || 500;
    const data = e?.response?.data;
    console.error("ELEVEN /voices error:", code, data || e.message);

    return res.status(500).json({
      error: "Voices fetch failed",
      statusFromEleven: code,
      upstream: data || e.message
    });
  }
});

/**
 * POST /tts
 * Body:
 * {
 *   "text": "Ahoj ako sa máš",
 *   "voiceId": "JBFqnCBsd6RMkjVDRZzb",
 *   "model": "eleven_multilingual_v2" (optional),
 *   "voice_settings": { ... } (optional)
 * }
 *
 * Odpoveď: audio/mpeg stream
 */
router.post("/tts", async (req, res) => {
  try {
    if (!ELEVEN_API_KEY) {
      return res.status(500).json({
        error: "Missing ELEVEN_API_KEY on server",
        hint: "Nastav ELEVEN_API_KEY v Render → Environment Variables."
      });
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

    let elevenResp;
    try {
      elevenResp = await axios.post(
        `${ELEVEN_BASE}/v1/text-to-speech/${voiceId}`,
        payload,
        {
          headers: {
            "xi-api-key": ELEVEN_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg"
          },
          responseType: "arraybuffer",
          timeout: 60000
        }
      );
    } catch (err) {
      const statusFromEleven = err?.response?.status || 500;
      const upstreamData     = err?.response?.data;

      console.error(
        "ELEVEN /tts error:",
        statusFromEleven,
        upstreamData || err.message
      );

      return res.status(500).json({
        error: "TTS failed",
        statusFromEleven,
        upstream: upstreamData || err.message,
        note: "Najčastejšie: zlý/expired API kľúč, hlas nedostupný pre tento účet, alebo vyčerpané kredity."
      });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    return res.send(Buffer.from(elevenResp.data));

  } catch (e) {
    console.error("SERVER /tts handler crash:", e.message);
    return res.status(500).json({
      error: "Gateway crash",
      details: e.message
    });
  }
});

export default router;
