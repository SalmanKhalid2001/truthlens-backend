import express from "express";
import History from "../models/History.js";

const router = express.Router();

// Get user history
router.get("/history", async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    const history = await History.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json(history);
  } catch (err) {
    console.error("[history]", err.message);
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

export default router;
