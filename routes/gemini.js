if (!process.env.GEMINI_API_KEY) {
  console.warn(
    "⚠️  GEMINI_API_KEY nie je nastavený! Bez toho /templates/facebook-ad nebude fungovať."
  );
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * POST /templates/facebook-ad
 * Body:
 * {
 *   "product": "čo predávaš",
 *   "audience": "koho cieľiš",
 *   "tone": "tón komunikácie (optional)",
 *   "language": "slovenčina / english / ... "
 * }
 *
 * Response:
 * { "output": "Varianta 1:\n...\nVarianta 2:\n..." }
 */
app.post("/templates/facebook-ad", async (req, res) => {
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

    // tu je dôležité: používame nový platný model
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-pro" // môžeš dať "gemini-2.5-flash" ak chceš lacnejšie/rýchlejšie
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

/* ======================= Start ======================= */
app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
