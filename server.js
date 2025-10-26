import express from "express";
import cors from "cors";
import helmet from "helmet";

import deeplRoutes from "./routes/deepl.js";
import elevenRoutes from "./routes/elevenlabs.js";
import geminiRoutes from "./routes/gemini.js";
import heygenRoutes from "./routes/heygen.js"; // <--- NOVÉ

const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (_req, res) => res.json({ ok: true }));

// pripojenie jednotlivých modulov
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes); // <--- NOVÉ

app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
