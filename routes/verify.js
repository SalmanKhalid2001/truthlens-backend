import express from "express";
import History from "../models/History.js";
import { searchWikipediaTopTitle, getWikipediaSummaryByTitle } from "../utils/wiki.js";
import { searchGNews } from "../utils/gnews.js";
import { callLLM } from "../utils/callLLM.js";

const router = express.Router();

router.post("/", async (req, res) => {
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
    } catch (e) {
      console.warn("[wiki] failed:", e?.message);
    }

    // 2️⃣ GNews
    let gnewsLinks = [];
    try {
      gnewsLinks = await searchGNews(claim, {
        apiKey: process.env.GNEWS_API_KEY,
        lang: process.env.GNEWS_LANG || "en",
        max: Number(process.env.GNEWS_MAX || 5),
      });
    } catch (e) {
      console.warn("[gnews] failed:", e?.message);
    }

    // 3️⃣ LLM
    let modelResult = {
      verdict: "Uncertain",
      confidence: 50,
      summary: "Using news + Wikipedia only.",
      sources: []
    };

    try {
      if (String(process.env.NO_LLM).toLowerCase() !== "true") {
        modelResult = await callLLM({
          claim,
          wiki,
          news: gnewsLinks,
          env: process.env
        });
      }
    } catch (e) {
      console.warn("[LLM] failed:", e?.message);
    }

    // 4️⃣ Merge Sources
    const srcSet = new Set();
    (modelResult.sources || []).forEach(u => u && srcSet.add(u));
    if (wiki?.url) srcSet.add(wiki.url);
    gnewsLinks.forEach(a => a?.url && srcSet.add(a.url));

    // 5️⃣ Save to MongoDB
    await History.create({
      claim,
      verdict: modelResult.verdict,
      confidence: modelResult.confidence,
      summary: modelResult.summary,
      sources: Array.from(srcSet),
      wikipedia: wiki || null,
      gnews: gnewsLinks || []
    });

    // 6️⃣ Response
    res.json({
      verdict: modelResult.verdict,
      confidence: modelResult.confidence,
      summary: modelResult.summary,
      sources: Array.from(srcSet),
      ...(wiki ? { wikipedia: wiki } : {}),
      ...(gnewsLinks.length ? { gnews: gnewsLinks } : {})
    });

  } catch (err) {
    console.error("[/api/verify] error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;