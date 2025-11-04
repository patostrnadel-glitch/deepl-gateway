// routes/seedream4.js
import express from "express";
import axios from "axios";

const router = express.Router();

const NOVITA_API_KEY  = process.env.NOVITA_API_KEY;
const NOVITA_BASE_URL = process.env.NOVITA_BASE_URL || "https://api.novita.ai";

/**
 * Normalizácia 'size':
 *  - ak príde "1K" | "2K" | "4K", pošleme to priamo
 *  - ak príde width & height, zlepíme to na "WIDTHxHEIGHT"
 *  - ak príde custom string typu "2048x2048", necháme tak
 */
function normalizeSize({ size, width, height }) {
  const PRESETS = new Set(["1K", "2K", "4K"]);
  if (size && PRESETS.has(String(size).toUpperCase())) {
    return String(size).toUpperCase();
  }
  if (!size && width && height) {
    return `${Number(width)}x${Number(height)}`;
  }
  return size || undefined; // napr. "2048x2048" alebo necháme default z API
}

/**
 * Bezpečná validácia 'sequential_image_generation'
 */
function normalizeSeqMode(mode) {
  const allowed = new Set(["auto", "disabled"]);
  if (!mode) return "disabled"; // default podľa dokumentácie
  const asStr = String(mode).toLowerCase();
  return allowed.has(asStr) ? asStr : "disabled";
}

/**
 * POST /seedream4/generate
 * Body (JSON):
 * {
 *   prompt: string (required),
 *   images?: string[] (URL alebo data:image/...;base64,...),
 *   // voľba veľkosti (jedna z možností):
 *   size?: "1K"|"2K"|"4K"|"2048x2048"|...,
 *   width?: number,   // alternatíva k 'size'
 *   height?: number,  // alternatíva k 'size'
 *   sequential_image_generation?: "auto"|"disabled",
 *   max_images?: number (1..15, účinné iba pri auto),
 *   watermark?: boolean
 * }
 *
 * Response: { ok: true, images: [<url>, ...] }
 */
router.post("/seedream4/generate", async (req, res) => {
  try {
    const {
      prompt,
      images,
      size,
      width,
      height,
      sequential_image_generation,
      max_images,
      watermark
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' (string required)" });
    }

    const payload = {
      prompt,
      ...(Array.isArray(images) && images.length ? { images } : {}),
      ...(normalizeSize({ size, width, height }) ? { size: normalizeSize({ size, width, height }) } : {}),
      sequential_image_generation: normalizeSeqMode(sequential_image_generation),
      ...(Number.isInteger(max_images) ? { max_images: Math.max(1, Math.min(15, max_images)) } : {}),
      ...(typeof watermark === "boolean" ? { watermark } : {}),
    };

    const r = await axios.post(
      `${NOVITA_BASE_URL}/v3/seedream-4.0`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${NOVITA_API_KEY}`,
          "Content-Type": "application/json",
        },
        timeout: 60000
      }
    );

    const urls = Array.isArray(r.data?.images) ? r.data.images : [];
    if (!urls.length) {
      return res.status(502).json({
        error: "NO_IMAGES",
        details: "Novita API nevrátilo žiadne images"
      });
    }
    return res.json({ ok: true, images: urls, meta: { count: urls.length } });
  } catch (e) {
    const status = e?.response?.status;
    const data   = e?.response?.data;
    console.error("Seedream4 /generate error:", status, data || e.message);
    return res.status(500).json({ error: "SERVER_ERROR", details: data || e.message });
  }
});

/**
 * GET /seedream4/sizes
 * Pomocný endpoint – odporúčané rozmery z dokumentácie + preset "1K/2K/4K".
 */
router.get("/seedream4/sizes", (_req, res) => {
  return res.json({
    presets: ["1K", "2K", "4K"],
    recommended: [
      { aspect_ratio: "1:1",   size: "2048x2048" },
      { aspect_ratio: "4:3",   size: "2304x1728" },
      { aspect_ratio: "3:4",   size: "1728x2304" },
      { aspect_ratio: "16:9",  size: "2560x1440" },
      { aspect_ratio: "9:16",  size: "1440x2560" },
      { aspect_ratio: "3:2",   size: "2496x1664" },
      { aspect_ratio: "2:3",   size: "1664x2496" },
      { aspect_ratio: "21:9",  size: "3024x1296" },
    ],
    notes: {
      default: "2048x2048",
      total_pixels: "[1024x1024, 4096x4096]",
      aspect_ratio_range: "[1/16, 16]",
      max_input_refs: 10,
      max_total_images: 15
    }
  });
});

export default router;
