import express from "express";
import axios from "axios";

const router = express.Router();

// Vytvorenie generovania fotky avatara
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
      appearance,
      aspectRatio,   // nový nepovinný parameter z frontendu
      imageCount     // nový nepovinný parameter z frontendu
    } = req.body || {};

    // povinné polia
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

    // DEBUG info na cenu/tokeny
    console.log("photo-avatar/generate req meta:", {
      aspectRatio,
      imageCount
    });

    // voláme HeyGen API na vytvorenie AI foto avatara
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
        // NOTE: ak HeyGen neskôr podporí aspect/počet obrázkov, doplníme sem.
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

    console.log("photo-avatar/generate -> generationId:", generationId);

    return res.json({
      generationId,
      status: "requested"
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

// Polling statusu generovania
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

    // voláme HeyGen API na status
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

    console.log("photo-avatar/status ->", {
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
