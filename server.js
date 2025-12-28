import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";

import History from "./models/History.js";
import { searchWikipediaTopTitle, getWikipediaSummaryByTitle } from "./utils/wiki.js";
import { searchGNews } from "./utils/gnews.js";
import { callLLM } from "./utils/callLLM.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5050;

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json());

/* ---------- DATABASE CONNECTION ---------- */
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Atlas connected"))
  .catch(err => {
    console.error("❌ MongoDB error:", err);
    process.exit(1);
  });

/* ---------- HEALTH CHECK ---------- */
app.get("/health", (_, res) => res.json({ ok: true }));

/* ---------- VERIFY CLAIM ---------- */
app.post("/api/verify", async (req, res) => {
  const { claim } = req.body || {};

  try {
    if (!claim || !claim.trim()) {
      return res.status(400).json({ error: "claim is required" });
    }

    // 1️⃣ Wikipedia
    let wiki = null;
    try {
      const title = await searchWikipediaTopTitle(claim);
      if (title) wiki = await getWikipediaSummaryByTitle(title);
    } catch {}

    // 2️⃣ GNews
    let gnewsLinks = [];
    try {
      gnewsLinks = await searchGNews(claim, {
        apiKey: process.env.GNEWS_API_KEY,
        lang: process.env.GNEWS_LANG || "en",
        max: Number(process.env.GNEWS_MAX || 5),
      });
    } catch {}

    // 3️⃣ LLM
    let modelResult = {
      verdict: "Uncertain",
      confidence: 50,
      summary: "Using news + Wikipedia only.",
      sources: []
    };

    if (String(process.env.NO_LLM).toLowerCase() !== "true") {
      try {
        modelResult = await callLLM({
          claim,
          wiki,
          news: gnewsLinks,
          env: process.env
        });
      } catch {}
    }

    // 4️⃣ Merge Sources
    const srcSet = new Set();
    modelResult.sources?.forEach(u => u && srcSet.add(u));
    if (wiki?.url) srcSet.add(wiki.url);
    gnewsLinks.forEach(a => a?.url && srcSet.add(a.url));

    // 5️⃣ Save to DB ⭐
    await History.create({
      claim,
      verdict: modelResult.verdict,
      confidence: modelResult.confidence,
      summary: modelResult.summary,
      sources: [...srcSet],
      wikipedia: wiki || null,
      gnews: gnewsLinks || []
    });

    // 6️⃣ Response
    res.json({
      verdict: modelResult.verdict,
      confidence: modelResult.confidence,
      summary: modelResult.summary,
      sources: [...srcSet],
      ...(wiki ? { wikipedia: wiki } : {}),
      ...(gnewsLinks.length ? { gnews: gnewsLinks } : {})
    });

  } catch (err) {
    console.error("❌ /api/verify:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ---------- HISTORY APIs ---------- */
app.get("/api/history", async (_, res) => {
  const history = await History.find({}, { claim: 1, createdAt: 1 })
    .sort({ createdAt: -1 })
    .limit(20);

  res.json(history);
});

app.get("/api/history/:id", async (req, res) => {
  const item = await History.findById(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

/* ---------- START SERVER ---------- */
app.listen(port, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${port}`);
});
