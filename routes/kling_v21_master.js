// routes/kling_v21_master.js
import express from "express";
import axios from "axios";

const router = express.Router();

const NOVITA_API_KEY  = process.env.NOVITA_API_KEY;
const NOVITA_BASE_URL = process.env.NOVITA_BASE_URL || "https://api.novita.ai";

/**
 * POST /kling-v21/generate
 * Body (JSON):
 * {
 *   "prompt": "text prompt",          // required
 *   "duration": "5" | "10",           // default "5"
 *   "aspect_ratio": "16:9"|"9:16"|"1:1", // default "16:9"
 *   "guidance_scale": 0.5,            // optional (0-1)
 *   "negative_prompt": "optional"
 * }
 *
 * Response:
 * { ok: true, generationId: "<TASK_ID>", status: "queued" }
 */
router.post("/kling-v21/generate", async (req, res) => {
  try {
    const {
      prompt,
      duration = "5",
      aspect_ratio = "16:9",
      guidance_scale,
      negative_prompt
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'" });
    }

    const allowedDur = ["5", "10", 5, 10];
    const allowedAR  = ["16:9", "9:16", "1:1"];

    if (!allowedDur.includes(duration)) {
      return res.status(400).json({ error: "Invalid 'duration' (use 5 or 10)" });
    }
    if (!allowedAR.includes(aspect_ratio)) {
      return res.status(400).json({ error: "Invalid 'aspect_ratio' (use 16:9, 9:16, 1:1)" });
    }

    const payload = {
      prompt,
      duration: String(duration),
      aspect_ratio,
      ...(typeof guidance_scale === "number" ? { guidance_scale } : {}),
      ...(negative_prompt ? { negative_prompt } : {})
    };

    const r = await axios.post(
      `${NOVITA_BASE_URL}/v3/async/kling-v2.1-t2v-master`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${NOVITA_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const taskId = r.data?.task_id;
    if (!taskId) {
      return res.status(502).json({
        error: "NO_TASK_ID",
        details: "Novita API did not return task_id"
      });
    }

    return res.json({ ok: true, generationId: taskId, status: "queued" });
  } catch (e) {
    console.error("KLING V2.1 /kling-v21/generate error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});

/**
 * GET /kling-v21/status/:taskId
 * Polling výsledku (rovnaký Task Result endpoint).
 */
router.get("/kling-v21/status/:taskId", async (req, res) => {
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

    const task     = r.data?.task || {};
    const status   = task.status;
    const progress = task.progress_percent ?? 0;
    const eta      = task.eta ?? 0;
    const reason   = task.reason || "";

    if (status === "TASK_STATUS_SUCCEED") {
      // pri T2V bývajú výstupy vo videos[0].video_url
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
        reason: reason || "Unknown error from model",
        meta: { progress, eta, taskId }
      });
    }

    return res.json({
      status: "in_progress",
      meta: { progress, eta, taskId }
    });
  } catch (e) {
    console.error("KLING V2.1 /kling-v21/status error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});

export default router;
