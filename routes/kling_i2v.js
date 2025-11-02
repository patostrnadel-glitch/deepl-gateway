// routes/kling_i2v.js
import express from "express";
import axios from "axios";

const router = express.Router();

const NOVITA_API_KEY  = process.env.NOVITA_API_KEY;
const NOVITA_BASE_URL = process.env.NOVITA_BASE_URL || "https://api.novita.ai";

/**
 * POST /kling-i2v/generate
 *
 * Body:
 * {
 *   "image": "<base64 obrázok>",
 *   "prompt": "hyperrealistic cyberpunk street",
 *   "mode": "Standard" | "Professional",
 *   "duration": "5" | "10",
 *   "guidance_scale": 0.5,
 *   "negative_prompt": "low quality, blurry"
 * }
 *
 * Response:
 * {
 *   "ok": true,
 *   "generationId": "TASK_ID",
 *   "status": "queued"
 * }
 */
router.post("/kling-i2v/generate", async (req, res) => {
  try {
    const {
      image,
      prompt,
      mode = "Standard",
      duration = "5",
      guidance_scale = 0.5,
      negative_prompt = ""
    } = req.body || {};

    if (!image || !prompt) {
      return res.status(400).json({ error: "Missing image or prompt" });
    }

    const payload = {
      image,
      prompt,
      mode,
      duration,
      guidance_scale,
      negative_prompt
    };

    const r = await axios.post(
      `${NOVITA_BASE_URL}/v3/async/kling-v2.1-i2v`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${NOVITA_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 60000
      }
    );

    const taskId = r.data?.task_id;
    if (!taskId) {
      return res.status(502).json({
        error: "NO_TASK_ID",
        details: "Novita API did not return task_id"
      });
    }

    return res.json({
      ok: true,
      generationId: taskId,
      status: "queued"
    });
  } catch (e) {
    console.error("KLING I2V /generate error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});

/**
 * GET /kling-i2v/status/:taskId
 *
 * Polling stav generovania videa podľa taskId.
 */
router.get("/kling-i2v/status/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId" });
    }

    const r = await axios.get(
      `${NOVITA_BASE_URL}/v3/async/task-result`,
      {
        headers: { "Authorization": `Bearer ${NOVITA_API_KEY}` },
        params: { task_id: taskId },
        timeout: 20000
      }
    );

    const task      = r.data?.task || {};
    const status    = task.status;
    const progress  = task.progress_percent ?? 0;
    const eta       = task.eta ?? 0;
    const reason    = task.reason || "";

    if (status === "TASK_STATUS_SUCCEED") {
      const firstVideo = Array.isArray(r.data?.videos) ? r.data.videos[0] : null;
      const videoUrl   = firstVideo?.video_url || null;

      return res.json({
        status: "success",
        videoUrl,
        meta: { progress, eta, taskId }
      });
    }

    if (status === "TASK_STATUS_FAILED") {
      return res.json({
        status: "failed",
        reason: reason || "Unknown error",
        meta: { progress, eta, taskId }
      });
    }

    return res.json({
      status: "in_progress",
      meta: { progress, eta, taskId }
    });
  } catch (e) {
    console.error("KLING I2V /status error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});

export default router;
