router.post("/heygenavatar/generate", async (req, res) => {
  try {
    const { prompt, avatar, voice, aspect, duration } = req.body || {};

    // Validácia vstupov
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

    // Debug log pred requestom
    console.log("→ heygenavatar/generate INPUT {");
    console.log("  prompt:", prompt);
    console.log("  avatar:", avatar);
    console.log("  voice:", voice);
    console.log("  aspect:", aspect);
    console.log("  duration:", duration);
    console.log("}");

    /**
     * Dôležité:
     * HeyGen sa sťažuje:
     *   "video_inputs.0.character is invalid: Unable to extract tag using discriminator 'type'"
     * => character musí mať 'type'.
     *
     * Skúsime type: "avatar".
     * Ak by to padalo rovnako, ďalší kandidát je "digital_human".
     */
    const heygenPayload = {
      video_inputs: [
        {
          character: {
            type: "avatar",        // ⬅️ kritické doplnenie
            avatar_id: avatar,     // napr. "Daisy"
            voice_id: voice        // napr. "sk_female"
          },
          input_text: prompt       // text ktorý má avatar povedať
        }
      ],
      aspect_ratio: aspect || "16:9",
      duration_seconds: Number(duration) || 15
    };

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

    console.log("✔ heygenavatar/generate OK ->", {
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
      "ERR /heygenavatar/generate (outer):",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: "HEYGEN_GENERATE_FAILED",
      details: err?.response?.data || err.message
    });
  }
});
