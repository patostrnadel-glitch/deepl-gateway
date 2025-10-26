import express from "express";
import cors from "cors";
import helmet from "helmet";

import deeplRoutes from "./routes/deepl.js";
import elevenRoutes from "./routes/elevenlabs.js";
import geminiRoutes from "./routes/gemini.js";
import heygenRoutes from "./routes/heygen.js";
import photoAvatarRoutes from "./routes/photoAvatar.js"; // musí sedieť s názvom súboru

const app = express();

// bezpečnostné hlavičky
app.use(helmet());

// CORS – povolíme tvoj web ai.developerska.eu
app.use(
  cors({
    origin: "https://ai.developerska.eu",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// preflight handler pre všetky cesty
app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "https://ai.developerska.eu");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res.sendStatus(200);
});

// JSON body
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// API routy
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes);

// štart
app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
