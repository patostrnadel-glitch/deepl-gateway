// routes/heygentexttoVideo.js
import express from "express";
import axios from "axios";

const router = express.Router();

// POST /heygen-video/generate
router.post("/heygen-video/generate", async (req, res) => {
  try {
    const { scriptText, avatarId, voiceId, testMode } = req.body || {};

    if (!scriptText || !avatarId || !voiceId) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        details:
          "Required fields: scriptText, avatarId, voiceId. Optional: testMode(boolean)."
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
      return res.status(500).json({
        error: "SERVER_CONFIG",
        details: "HEYGEN_API_KEY is missing in environment."
      });
    }

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
      test: typeof testMode === "boolean" ? testMode : true
    };

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

    const jobId =
      data?.data?.id ??
      data?.id ??
      null;

    const statusVal =
      data?.data?.status ??
      data?.status ??
      null;

    console.log("HeyGen generate ->", { jobId, status: statusVal });

    return res.json({
      ok: true,
      jobId,
      status: statusVal
    });
  } catch (err) {
    console.error(
      "ERR /heygen-video/generate:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "HEYGEN_GENERATE_FAILED",
      details: err?.response?.data || err.message
    });
  }
});

// GET /heygen-video/status/:jobId
router.get("/heygen-video/status/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;

    if (!jobId) {
      return res.status(400).json({
        error: "MISSING_JOB_ID",
        details: "Provide jobId in URL /heygen-video/status/:jobId"
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
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
      data?.data?.status ??
      data?.status ??
      null;

    const videoUrl =
      data?.data?.video_url ??
      data?.video_url ??
      null;

    console.log("HeyGen status ->", {
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
      "ERR /heygen-video/status/:jobId:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "HEYGEN_STATUS_FAILED",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
