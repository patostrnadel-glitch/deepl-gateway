// routes/heygen.js
import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /heygen/generate
 * Účel:
 *  - Frontend ti pošle text čo má avatar povedať, ID avatara a ID hlasu
 *  - My zavoláme HeyGen API a vrátime späť jobId
 *
 * Očakávaný body z frontendu:
 * {
 *   "scriptText": "Ahoj, vitaj na našej stránke...",
 *   "avatarId": "Daisy-inskirt-20220818",
 *   "voiceId": "2d5b0e6cf36f460aa7fc47e3eee4ba54",
 *   "testMode": true   // optional, default true
 * }
 */
router.post("/heygen/generate", async (req, res) => {
  try {
    const { scriptText, avatarId, voiceId, testMode } = req.body || {};

    // 1. Validácia vstupov
    if (!scriptText || !avatarId || !voiceId) {
      return res.status(400).json({
        error: "Missing required fields. Required: scriptText, avatarId, voiceId."
      });
    }

    // 2. Skontroluj či máme API kľúč
    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
      return res.status(500).json({
        error: "Server configuration error: HEYGEN_API_KEY is missing."
      });
    }

    // 3. Postav request na HeyGen
    const payload = {
      video_inputs: [
        {
          character: {
            type: "avatar",
            avatar_id: avatarId,
            avatar_style: "normal"
          },
          voice: {
            type: "text",
            input_text: scriptText,
            voice_id: voiceId
          }
        }
      ],
      // test mód - lacnejšie/obmedzené, nechávame default true ak nepríde nič
      test: typeof testMode === "boolean" ? testMode : true
    };

    const heygenResponse = await axios.post(
      "https://api.heygen.com/v2/video/generate",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY
        },
        timeout: 60000 // 60s pre istotu
      }
    );

    // HeyGen ti vráti napr. { data: { id, status, ... } } alebo podobnú štruktúru
    // My to normalizujeme pre frontend.
    const data = heygenResponse.data;

    // Bezpečnostne zalogujeme iba minimum
    console.log("HeyGen generate response:", {
      id: data?.data?.id || data?.id,
      status: data?.data?.status || data?.status
    });

    return res.json({
      jobId: data?.data?.id || data?.id || null,
      status: data?.data?.status || data?.status || null,
      raw: data // voliteľné, môžeš vyhodiť ak nechceš posielať nič navyše
    });
  } catch (err) {
    console.error("Chyba pri /heygen/generate:", err?.response?.data || err.message);

    // Ak HeyGen vráti error response, pošleme ho dopredu kvôli debug-u
    return res.status(500).json({
      error: "Failed to create HeyGen video job.",
      details: err?.response?.data || err.message
    });
  }
});

/**
 * GET /heygen/status/:jobId
 * Účel:
 *  - Frontend polluje stav rendrovania videa
 *  - Keď je status "completed", HeyGen by mal mať dostupné video_url
 *
 * Frontend volá napr. /heygen/status/abc123
 */
router.get("/heygen/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "Missing jobId in URL."
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
      return res.status(500).json({
        error: "Server configuration error: HEYGEN_API_KEY is missing."
      });
    }

    // Tu voláme HeyGen endpoint na zistenie stavu jobu.
    // Podľa ich API (stav k 26.10.2025) sa typicky používa GET na niečo ako:
    //   GET https://api.heygen.com/v2/video/status/<jobId>
    // alebo podobný status endpoint podľa dokumentácie.
    //
    // Poznámka:
    // Ak sa presný path mierne líši v tvojej verzii HeyGen API (napr. /videos/{id}),
    // len uprav URL nižšie. Logika ostáva rovnaká.
    //
    // Tu ti pripravím najčastejší vzor: /v2/video/status/{id}

    const statusResponse = await axios.get(
      `https://api.heygen.com/v2/video/status/${jobId}`,
      {
        headers: {
          "X-Api-Key": process.env.HEYGEN_API_KEY
        },
        timeout: 30000
      }
    );

    const data = statusResponse.data;

    // Predpokladaná štruktúra: { data: { status: "...", video_url: "..." } }
    const statusVal = data?.data?.status || data?.status || null;
    const videoUrl = data?.data?.video_url || data?.video_url || null;

    console.log("HeyGen status resp:", {
      jobId,
      status: statusVal,
      videoUrlPresent: !!videoUrl
    });

    return res.json({
      status: statusVal,
      videoUrl: videoUrl || null
    });
  } catch (err) {
    console.error("Chyba pri /heygen/status/:jobId:", err?.response?.data || err.message);

    return res.status(500).json({
      error: "Failed to get HeyGen job status.",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
