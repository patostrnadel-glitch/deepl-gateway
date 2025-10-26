import express from "express";
import cors from "cors";
import helmet from "helmet";

import deeplRoutes from "./routes/deepl.js";
import elevenRoutes from "./routes/elevenlabs.js";
import geminiRoutes from "./routes/gemini.js";
import heygenRoutes from "./routes/heygen.js";
import photoAvatarRoutes from "./routes/photoAvatar.js"; // <-- nový import

const app = express();

// bezpečnosť hlavičiek
app.use(helmet());

// CORS - momentálne otvorené pre všetkých (MVP test).
// Keď to bude fungovať, vieme to sprísniť na konkrétnu doménu tvojho webu.
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);

// JSON body
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// tvoje API moduly
app.use("/", deeplRoutes);
app.use("/", elevenRoutes);
app.use("/", geminiRoutes);
app.use("/", heygenRoutes);
app.use("/", photoAvatarRoutes); // <-- nová route

// štart servera
app.listen(PORT, () => {
  console.log(`🚀 API gateway running on port ${PORT}`);
});
