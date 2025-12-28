import mongoose from "mongoose";

const historySchema = new mongoose.Schema(
  {
    claim: { type: String, required: true },
    verdict: String,
    confidence: Number,
    summary: String,
    sources: [String],

    userId: { type: String, default: "guest" } // later replace with auth
  },
  { timestamps: true }
);

export default mongoose.model("History", historySchema);
