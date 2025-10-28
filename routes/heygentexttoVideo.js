// routes/heygentexttoVideo.js
import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /heygentexttovideo/generate
 *
 * Očakáva v req.body:
 * {
 *   prompt:   "čo chceme vo videu",
 *   ratio:    "16:9" | "1:1" | "4:3" | "9:16",
 *   duration: 5 | 15 | 30 | 60 (sekundy)
 * }
 *
 * Vráti:
 * {
 *   ok: true,
 *   jobId: "abc123",
 *   status: "pending" | "in_progress" | ...
 * }
 */
router.post("/heygentexttovideo/generate", async (req, res) => {
  try {
    const { prompt, ratio, duration } = req.body || {};

    // Validácia vstupov
    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PROMPT",
        details: "Field 'prompt' is required."
      });
    }

    if (!ratio) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_RATIO",
        details: "Field 'ratio' is required (e.g. '16:9', '1:1')."
      });
    }

    if (!duration) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_DURATION",
        details: "Field 'duration' is required (e.g. 5, 15, 30, 60)."
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

    // 🔎 Log pre debug do Render logov
    console.log("→ heygentexttovideo/generate INPUT", {
      prompt,
      ratio,
      duration
    });

    /**
     * PRÍPRAVA PAYLOADU PRE HEYGEN
     *
     * Teraz posielame polia takto:
     *  - prompt      → text scény / opis
     *  - ratio       → "16:9", "1:1", "9:16", ...
     *  - duration    → integer v sekundách
     *
     * Ak HeyGen API očakáva iné keys (napr. prompt_text / aspect_ratio / duration_seconds),
     * tu je presne to miesto, kde to vieš zmeniť.
     *
     * Ja ti teraz urobím payload v "čistej" forme (prompt/ratio/duration),
     * lebo tak sme to nastavili aj vo WP snippete.
     */

    const heygenPayload = {
      prompt: prompt,
      ratio: ratio,
      duration: Number(duration),
      sound: false,
      resolution: "1080p"
    };

    // 🔥 volanie HeyGen API
    // Poznámka: endpoint si uprav podľa toho, čo máš v ich dokumentácii/účte.
    // Niektoré účty používajú /v2/video/generate, iné /v1/video/generate.
    // Ty si mal /v2/video/generate, tak to ponechám.
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

    // 🎯 extrakcia jobId a statusu z odpovede
    const jobId =
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

    console.log("✔ heygentexttovideo/generate OK ->", {
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
      "ERR /heygentexttovideo/generate (outer):",
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
 * GET /heygentexttovideo/status/:jobId
 *
 * Pollovanie stavu jobu.
 *
 * Vráti:
 * {
 *   status: "in_progress" | "completed" | "failed",
 *   videoUrl: "https://....mp4" | null
 * }
 */
router.get("/heygentexttovideo/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "MISSING_JOB_ID",
        details: "Provide jobId in URL /heygentexttovideo/status/:jobId"
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

    console.log("↺ heygentexttovideo/status ->", {
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
      "ERR /heygentexttovideo/status/:jobId (outer):",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "HEYGEN_STATUS_FAILED",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
