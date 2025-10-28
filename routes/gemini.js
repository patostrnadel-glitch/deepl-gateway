import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router = express.Router();

if (!process.env.GEMINI_API_KEY) {
  console.warn("⚠️  GEMINI_API_KEY nie je nastavený! Bez toho Gemini endpointy nebudú fungovať.");
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
- Vráť výsledok v prehľadnej podobe:
  Varianta 1:
  ...
  Varianta 2:
  ...
  Varianta 3:
  ...
`.trim();

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro"
    });

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "";

    return res.json({ output: text });
  } catch (err) {
    console.error("Gemini /templates/facebook-ad error:", err);
    return res.status(500).json({
      error: "Template generation failed",
      detail: err?.message || String(err)
    });
  }
});

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

POŽIADAVKY:
- Každý titulok do ~65 znakov.
- Titulky musia byť klikateľné, ale nie lacný fake clickbait.
- Majú vyzerať ako reálne YouTube titulky, ktoré by si reálne klikol.
- Vráť presne tento formát:
1. ...
2. ...
3. ...
4. ...
5. ...
`.trim();

    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro"
    });

    const result = await model.generateContent(prompt);
    const text = result?.response?.text?.() || "";

    return res.json({ output: text });
  } catch (err) {
    console.error("Gemini /templates/youtube-title error:", err);
    return res.status(500).json({
      error: "Template generation failed",
      detail: err?.message || String(err)
    });
  }
});

export default router;

