// routes/kling.js
import express from "express";
import axios from "axios";

const router = express.Router();

const NOVITA_API_KEY  = process.env.NOVITA_API_KEY;
const NOVITA_BASE_URL = process.env.NOVITA_BASE_URL || "https://api.novita.ai";

/**
 * POST /kling/generate
 *
 * Body (od frontendu / WP):
 * {
 *   "prompt": "hyperrealistic cinematic slow pan across neon-lit rainy cyberpunk street, depth of field",
 *   "duration": 5,           // optional: 5 alebo 10 sekúnd, default 5
 *   "guidance_scale": 0.6,   // optional, default 0.5
 *   "negative_prompt": "low quality, blurry" // optional
 * }
 *
 * Response:
 * {
 *   "generationId": "TASK_ID_Z_NOVITA",
 *   "status": "queued"
 * }
 *
 * Poznámka:
 *  - Toto ešte nič neodpočíta z kreditov. Kredity riešiš buď:
 *    A) pred tým zavoláš /consume s feature_type "kling_video"
 *    B) alebo to dorobíme sem (transakčne ako pri /consume)
 */
router.post("/kling/generate", async (req, res) => {
  try {
    const {
      prompt,
      duration,
      guidance_scale,
      negative_prompt
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Missing 'prompt'" });
    }

    // priprav payload pre Novita AI KLING V1.6 Text-to-Video
    // mode: "Standard" => 720p video, lacnejšie, 5s alebo 10s. :contentReference[oaicite:5]{index=5}
    const payload = {
      mode: "Standard",
      prompt,
      negative_prompt: negative_prompt || "low quality",
      duration: duration ?? 5,
      guidance_scale: guidance_scale ?? 0.5
    };

    const r = await axios.post(
      `${NOVITA_BASE_URL}/v3/async/kling-v1.6-t2v`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${NOVITA_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    // Novita vráti len task_id, nič viac. :contentReference[oaicite:6]{index=6}
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
    console.error("KLING /kling/generate error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});


/**
 * GET /kling/status/:taskId
 *
 * Frontend pravidelne polluje:
 *   GET /kling/status/{taskId}
 *
 * Response success case:
 * {
 *   "status": "success",
 *   "videoUrl": "https://....mp4",
 *   "meta": {
 *      "progress": 100,
 *      "eta": 0
 *   }
 * }
 *
 * Response generating:
 * {
 *   "status": "in_progress",
 *   "meta": { "progress": 40, "eta": 12 }
 * }
 *
 * Response failed:
 * {
 *   "status": "failed",
 *   "reason": "..."
 * }
 */
router.get("/kling/status/:taskId", async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId" });
    }

    const r = await axios.get(
      `${NOVITA_BASE_URL}/v3/async/task-result`,
      {
        headers: {
          "Authorization": `Bearer ${NOVITA_API_KEY}`
        },
        params: {
          task_id: taskId
        },
        timeout: 20000
      }
    );

    // Štruktúra odpovede vyzerá takto pre úspech:
    // {
    //   "task": {
    //     "task_id": "...",
    //     "status": "TASK_STATUS_SUCCEED" | "TASK_STATUS_PROCESSING" | "TASK_STATUS_FAILED" | ...
    //     "progress_percent": 100,
    //     "eta": 0,
    //     "reason": ""
    //   },
    //   "videos": [
    //     {
    //       "video_url": "...mp4",
    //       "video_url_ttl": "3600",
    //       "video_type": "mp4"
    //     }
    //   ],
    //   "images": [],
    //   "audios": []
    // }
    // (podľa oficiálnej KLING V1.6 Text to Video dokumentácie). :contentReference[oaicite:7]{index=7}

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
        meta: {
          progress,
          eta,
          taskId
        }
      });
    }

    if (status === "TASK_STATUS_FAILED") {
      return res.json({
        status: "failed",
        reason: reason || "Unknown error from model",
        meta: {
          progress,
          eta,
          taskId
        }
      });
    }

    // in progress / queued / running
    return res.json({
      status: "in_progress",
      meta: {
        progress,
        eta,
        taskId
      }
    });
  } catch (e) {
    console.error("KLING /kling/status error:", e?.response?.status, e?.response?.data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: e.message });
  }
});

export default router;
