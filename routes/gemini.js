import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /templates/facebook-ad
 * Generuje text pre FB reklamu
 */
router.post("/templates/facebook-ad", async (req, res) => {
  try {
    const { product, audience, tone, language } = req.body || {};

    if (!product || !audience || !language) {
      return res.status(400).json({
        error: "Chýba product / audience / language"
      });
    }

    const prompt = `
Si špičkový marketingový copywriter.
Napíš 3 krátke varianty reklamného textu pre FACEBOOK ADS.

Produkt: ${product}
Cieľová skupina: ${audience}
Tón komunikácie: ${tone || "priateľský, sebavedomý"}
Jazyk výstupu: ${language}

POŽIADAVKY:
- Každá varianta max 2 vety.
- Musí byť chytľavá a jasná, nie generická.
- Použi priamu výzvu k akcii (napr. "Skús teraz", "Zisti viac").
- Výstup vo formáte:
  Varianta 1:
  Varianta 2:
  Varianta 3:
`.trim();

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return res.json({ output: text });

  } catch (err) {
    console.error("Gemini /templates/facebook-ad error:", err?.response || err?.message || err);
    return res.status(500).json({
      error: "Template generation failed",
      detail: err?.message || String(err)
    });
  }
});

/**
 * POST /templates/youtube-title
 * Generuje SEO-friendly YouTube titulky
 */
router.post("/templates/youtube-title", async (req, res) => {
  try {
    const { topic, language } = req.body || {};

    if (!topic || !language) {
      return res.status(400).json({
        error: "Chýba topic / language"
      });
    }

    const prompt = `
Si expert na YouTube SEO a CTR (click-through rate).
Vymysli 5 pútavých titulkov pre YouTube video.

Téma videa: ${topic}
Jazyk výstupu: ${language}

Požiadavky:
- Každý titulok do ~65 znakov.
- Klikateľné, ale nie fake clickbait.
- Použi formát:
1. ...
2. ...
3. ...
4. ...
5. ...
`.trim();

    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash"
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return res.json({ output: text });

  } catch (err) {
    console.error("Gemini /templates/youtube-title error:", err?.response || err?.message || err);
    return res.status(500).json({
      error: "Template generation failed",
      detail: err?.message || String(err)
    });
  }
});

export default router;
