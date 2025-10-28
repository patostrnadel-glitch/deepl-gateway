// routes/heygentexttoVideo.js
import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /heygentexttovideo/generate
 *
 * Očakáva v req.body:
 * {
 *   prompt: "čo chceme vo videu",
 *   aspect: "16:9" | "1:1" | "4:3" | "9:16",
 *   duration: 5 | 15 | 30 | 60
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
    const { prompt, aspect, duration } = req.body || {};

    if (!prompt) {
      return res.status(400).json({
        ok: false,
        error: "MISSING_PROMPT",
        details: "Field 'prompt' is required."
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

    // pripravíme payload pre HeyGen
    // POZOR: toto je generické, HeyGen real payload sa môže volať inak,
    // ale dodržíme náš interný kontrakt (prompt/aspect/duration)
    const payload = {
      prompt_text: prompt,
      aspect_ratio: aspect || "16:9",
      duration_seconds: duration ? Number(duration) : 15
    };

    // voláme HeyGen API (endpoint musí sedieť s tvojím plánom; ak máš iný path, prispôsob)
    const heygenResp = await axios.post(
      "https://api.heygen.com/v2/video/generate",
      payload,
      {
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY
        },
        timeout: 60000
      }
    );

    const data = heygenResp.data;

    // HeyGen typicky vráti ID jobu, ktoré potom pollujeme
    const jobId =
      data?.data?.id ||
      data?.id ||
      null;

    const statusVal =
      data?.data?.status ||
      data?.status ||
      null;

    if (!jobId) {
      console.error("HeyGen generate odpoveď bez jobId:", data);
      return res.status(500).json({
        ok: false,
        error: "NO_JOB_ID_FROM_PROVIDER",
        providerResponse: data
      });
    }

    console.log("HeyGen text2video generate ->", {
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
      "ERR /heygentexttovideo/generate:",
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

    const statusResp = await axios.get(
      `https://api.heygen.com/v2/video/status/${jobId}`,
      {
        headers: {
          "X-Api-Key": process.env.HEYGEN_API_KEY
        },
        timeout: 30000
      }
    );

    const data = statusResp.data;

    const statusVal =
      data?.data?.status ||
      data?.status ||
      null;

    const videoUrl =
      data?.data?.video_url ||
      data?.video_url ||
      null;

    console.log("HeyGen text2video status ->", {
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
      "ERR /heygentexttovideo/status/:jobId:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "HEYGEN_STATUS_FAILED",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
