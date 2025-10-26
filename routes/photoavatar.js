import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /photo-avatar/generate
 *
 * Očakávaný body z frontendu:
 * {
 *   "name": "Lina",
 *   "age": "Young Adult",
 *   "gender": "Woman",
 *   "ethnicity": "Asian American",
 *   "orientation": "horizontal",
 *   "pose": "half_body",
 *   "style": "Realistic",
 *   "appearance": "A stylish East Asian Woman in casual attire walking through a bustling city street"
 * }
 *
 * Návrat:
 * {
 *   "generationId": "def3076d2c8b4929acf269d8ea6b562e",
 *   "status": "requested"
 * }
 */
router.post("/photo-avatar/generate", async (req, res) => {
  try {
    const {
      name,
      age,
      gender,
      ethnicity,
      orientation,
      pose,
      style,
      appearance
    } = req.body || {};

    // validácia povinných polí
    if (
      !name ||
      !age ||
      !gender ||
      !ethnicity ||
      !orientation ||
      !pose ||
      !style ||
      !appearance
    ) {
      return res.status(400).json({
        error:
          "Missing required fields. Required: name, age, gender, ethnicity, orientation, pose, style, appearance."
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
      return res.status(500).json({
        error: "Server configuration error: HEYGEN_API_KEY is missing."
      });
    }

    // Zavoláme HeyGen Photo Avatar generate endpoint
    const heygenResp = await axios.post(
      "https://api.heygen.com/v2/photo_avatar/photo/generate",
      {
        name,
        age,
        gender,
        ethnicity,
        orientation,
        pose,
        style,
        appearance
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY,
          Accept: "application/json"
        },
        timeout: 60000
      }
    );

    const data = heygenResp.data;

    const generationId =
      data?.data?.generation_id || data?.generation_id || null;

    console.log("PhotoAvatar generate response:", {
      generationId
    });

    return res.json({
      generationId,
      status: "requested",
      raw: data // voliteľné, môžeš vymazať
    });
  } catch (err) {
    console.error(
      "Chyba pri /photo-avatar/generate:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "Failed to request photo avatar generation.",
      details: err?.response?.data || err.message
    });
  }
});

/**
 * GET /photo-avatar/status/:generationId
 *
 * Polling endpoint.
 *
 * Návrat:
 * - počas generovania:
 * {
 *   "status": "in_progress",
 *   "images": []
 * }
 *
 * - po dokončení:
 * {
 *   "status": "success",
 *   "images": [
 *      "https://resource2.heygen.ai/image/....",
 *      "https://resource2.heygen.ai/image/...."
 *   ]
 * }
 */
router.get("/photo-avatar/status/:generationId", async (req, res) => {
  try {
    const { generationId } = req.params;

    if (!generationId) {
      return res.status(400).json({
        error: "Missing generationId in URL."
      });
    }

    if (!process.env.HEYGEN_API_KEY) {
      console.error("HEYGEN_API_KEY nie je nastavený v env!");
      return res.status(500).json({
        error: "Server configuration error: HEYGEN_API_KEY is missing."
      });
    }

    // podľa tvojej dokumentácie:
    // GET https://api.heygen.com/v2/photo_avatar/generation/{id}
    const statusResp = await axios.get(
      `https://api.heygen.com/v2/photo_avatar/generation/${generationId}`,
      {
        headers: {
          Accept: "application/json",
          "X-Api-Key": process.env.HEYGEN_API_KEY
        },
        timeout: 30000
      }
    );

    const data = statusResp.data;

    const statusVal = data?.data?.status || null;
    const urls = data?.data?.image_url_list || [];

    console.log("PhotoAvatar status resp:", {
      generationId,
      status: statusVal,
      count: urls?.length || 0
    });

    return res.json({
      status: statusVal,
      images: urls || []
    });
  } catch (err) {
    console.error(
      "Chyba pri /photo-avatar/status/:generationId:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      error: "Failed to get avatar generation status.",
      details: err?.response?.data || err.message
    });
  }
});

export default router;
