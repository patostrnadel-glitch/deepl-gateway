import express from "express";
import axios from "axios";

const router = express.Router();

/**
 * POST /heygenavatar/generate
 *
 * WP nám sem pošle:
 * {
 *   prompt:   "čo má avatar povedať",
 *   avatar:   "Daisy" (alebo interné ID avatara z HeyGenu),
 *   voice:    "sk_female" (alebo interné ID voice modelu),
 *   aspect:   "16:9" | "1:1" | "9:16" | ...,
 *   duration: 5 | 15 | 30 | 60
 * }
 *
 * My to premapujeme na formát, ktorý HeyGen chce:
 *  - video_inputs[0].character musí mať aj "type"
 *  - input_text = čo má avatar povedať
 *
 * A čakáme, že HeyGen vráti jobId (video_id / id / job_id ...)
 * ktorý potom pollujeme v /heygenavatar/status/:jobId
 */
router.post("/heygenavatar/generate", async (req, res) => {
  try {
    const { prompt, avatar, voice, aspect, duration } = req.body || {};

    // 1. Validácia vstupov z WP
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

    // 2. Debug pre Render logy – nech vieme čo reálne posielame
    console.log("→ heygenavatar/generate INPUT {");
    console.log("  prompt:", prompt);
    console.log("  avatar:", avatar);
    console.log("  voice:", voice);
    console.log("  aspect:", aspect);
    console.log("  duration:", duration);
    console.log("}");

    /**
     * 3. HeyGen očakáva objekt s video_inputs.
     *
     * Chyba ktorú si mal:
     *   "video_inputs.0.character is invalid: Unable to extract tag using discriminator 'type'"
     *
     * Znamená: character musí obsahovať aj "type".
     *
     * Najčastejší typ pre talking avatar je "avatar".
     * (Ak by to ešte spadlo s rovnakou chybou, ďalší kandidát je "digital_human".
     *  Vtedy by stačilo zmeniť iba hodnotu v type.)
     */
    const heygenPayload = {
        video_inputs: [
            {
                character: {
                    type: "avatar",      // <- kritické: HeyGen chce discriminator "type"
                    avatar_id: avatar,   // napr. "Daisy" (musí to byť validné ID avatara v HeyGene)
                    voice_id: voice      // napr. "sk_female" (tiež musí byť validný voice ID)
                },
                input_text: prompt       // čo má avatar povedať nahlas
            }
        ],
        aspect_ratio: aspect || "16:9",
        duration_seconds: Number(duration) || 15
    };

    // 4. Zavoláme HeyGen API
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
        // Log pre Render debugging
        console.error("HeyGen API request FAILED:", apiErr?.response?.data || apiErr.message);

        // Odpoveď smerom späť do WP → frontendu
        return res.status(500).json({
            ok: false,
            error: "HEYGEN_GENERATE_FAILED",
            details: apiErr?.response?.data || apiErr.message
        });
    }

    const data = heygenResp.data;

    // 5. Vyextrahujeme jobId z rôznych možných fieldov
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

    // 6. Debug log pre Render (aby sme videli že sme uspeli)
    console.log("✔ heygenavatar/generate OK ->", {
        jobId,
        status: statusVal
    });

    // 7. Toto ide späť do WordPress AJAXu → do frontendu → frontend uloží jobId a spustí polling
    return res.json({
        ok: true,
        jobId,
        status: statusVal || "pending"
    });

  } catch (err) {
    console.error("ERR /heygenavatar/generate (outer):", err?.response?.data || err.message);

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
 * Frontend polluje túto route každé ~3s,
 * až kým HeyGen nepovie že status = completed
 * a nedá nám video_url.
 *
 * Odpoveď, ktorú mu pošleme:
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
    console.error("ERR /heygenavatar/status/:jobId (outer):", err?.response?.data || err.message);

    return res.status(500).json({
        error: "HEYGEN_STATUS_FAILED",
        details: err?.response?.data || err.message
    });
  }
});

export default router;
