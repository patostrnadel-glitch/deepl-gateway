// routes/heygenavatar.js
import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /heygenavatar/generate
 *
 * Očakáva v req.body:
 * {
 *   prompt:   "čo má avatar povedať",
 *   avatar:   "Daisy" | "Marcus" | ... (ID avatara v HeyGene),
 *   voice:    "sk_female" | "en_us_female" | ... (ID hlasu),
 *   aspect:   "16:9" | "1:1" | "9:16",
 *   duration: 5 | 15 | 30 | 60  (sekundy)
 * }
 *
 * Vráti:
 * {
 *   ok: true,
 *   jobId: "abc123",
 *   status: "pending" | "in_progress" | ...
 * }
 */
router.post("/heygenavatar/generate", async (req, res) => {
  try {
    const { prompt, avatar, voice, aspect, duration } = req.body || {};

    // --- 1. Validácia vstupov
    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PROMPT",
        details: "Field 'prompt' (text ktorý má avatar povedať) je povinný."
      });
    }

    if (!avatar) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_AVATAR",
        details: "Field 'avatar' (id avatara) je povinný."
      });
    }

    if (!voice) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_VOICE",
        details: "Field 'voice' (hlas/jazyk) je povinný."
      });
    }

    if (!aspect) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_ASPECT",
        details: "Field 'aspect' (napr. '16:9', '1:1', '9:16') je povinný."
      });
    }

    if (!duration) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_DURATION",
        details: "Field 'duration' (5/15/30/60) je povinný."
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY chýba v env!");
      return res.status(500).json({
        ok: false,
        error: "SERVER_CONFIG",
        details: "HEYGEN_API_KEY is missing in environment."
      });
    }

    // --- 2. Log pre Render, aby si videl čo posielame
    console.log("→ heygenavatar/generate INPUT", {
      prompt,
      avatar,
      voice,
      aspect,
      duration
    });

    /**
     * --- 3. PAYLOAD PRE HEYGEN ---
     *
     * Toto je KRITICKÉ:
     * HeyGen pri avatar videách neočakáva len 'prompt',
     * ale štruktúru typu "video_inputs".
     *
     * Toto je to, čo ti doposiaľ chýbalo a kvôli čomu vrátil:
     *   "video_inputs is invalid: Field required"
     *
     * V praxi tieto polia môžu mať iné presné názvy podľa tvojho plánu,
     * ale pattern je toto: zoznam scén, kde scéna povie text.
     *
     * Tu dávame minimálnu povinnú štruktúru, ktorú HeyGen typicky chce
     * pre "avatar hovorí text".
     */
    const heygenPayload = {
      video_inputs: [
        {
          character: {
            avatar_id: avatar,      // napr. "Daisy"
            voice_id: voice         // napr. "sk_female"
          },
          input_text: prompt        // text ktorý má avatar povedať
        }
      ],
      aspect_ratio: aspect || "16:9",
      duration_seconds: Number(duration) || 15
    };

    // --- 4. Zavoláme HeyGen API
    let heygenResp;
    try {
      heygenResp = await axios.post(
        "https://api.heygen.com/v2/video/generate",
        heygenPayload,
        {
          headers: {
            "Content-Type": "application/json",
            "X-Api-Key": process.env.HEYGEN_API_KEY
          },
          timeout: 60000
        }
      );
    } catch (apiErr) {
      console.error("HeyGen API request FAILED:", apiErr?.response?.data || apiErr.message);
      return res.status(500).json({
        ok: false,
        error: "HEYGEN_GENERATE_FAILED",
        details: apiErr?.response?.data || apiErr.message
      });
    }

    const data = heygenResp.data;

    /**
     * --- 5. Vytiahneme jobId/status z odpovede HeyGenu
     * Niektoré účty ho vrátia ako data.id,
     * niektoré ako data.video_id, niektoré ako id.
     */
    const jobId =
      data?.data?.video_id ||
      data?.data?.id ||
      data?.id ||
      data?.job_id ||
      null;

    const statusVal =
      data?.data?.status ||
      data?.status ||
      "pending";

    if (!jobId) {
      console.error("HeyGen generate odpoveď bez jobId:", data);
      return res.status(500).json({
        ok: false,
        error: "NO_JOB_ID_FROM_PROVIDER",
        providerResponse: data
      });
    }

    console.log("✔ heygenavatar/generate OK ->", {
      jobId,
      status: statusVal
    });

    return res.json({
      ok: true,
      jobId,
      status: statusVal || "pending"
    });

  } catch (err) {
    console.error(
      "ERR /heygenavatar/generate (outer):",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "HEYGEN_GENERATE_FAILED",
      details: err?.response?.data || err.message
    });
  }
});


/**
 * GET /heygenavatar/status/:jobId
 *
 * Pollovanie stavu jobu.
 *
 * Vráti:
 * {
 *   status: "in_progress" | "completed" | "failed",
 *   videoUrl: "https://....mp4" | null
 * }
 */
router.get("/heygenavatar/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "MISSING_JOB_ID",
        details: "Provide jobId in URL /heygenavatar/status/:jobId"
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY chýba v env!");
      return res.status(500).json({
        error: "SERVER_CONFIG",
        details: "HEYGEN_API_KEY is missing in environment."
      });
    }

    let statusResp;
    try {
      statusResp = await axios.get(
        `https://api.heygen.com/v2/video/status/${jobId}`,
        {
          headers: {
            "X-Api-Key": process.env.HEYGEN_API_KEY
          },
          timeout: 30000
        }
      );
    } catch (apiErr) {
      console.error("HeyGen status request FAILED:", apiErr?.response?.data || apiErr.message);
      return res.status(500).json({
        error: "HEYGEN_STATUS_FAILED",
        details: apiErr?.response?.data || apiErr.message
      });
    }

    const data = statusResp.data;

    const statusVal =
      data?.data?.status ||
      data?.status ||
      null;

    const videoUrl =
      data?.data?.video_url ||
      data?.video_url ||
      null;

    console.log("↺ heygenavatar/status ->", {
      jobId,
      status: statusVal,
      hasVideoUrl: !!videoUrl
    });

    return res.json({
      status: statusVal,
      videoUrl: videoUrl || null
    });

  } catch (err) {
    console.error(
      "ERR /heygenavatar/status/:jobId (outer):",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "HEYGEN_STATUS_FAILED",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
