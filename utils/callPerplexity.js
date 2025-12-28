// server/utils/callPerplexity.js
import fetch from "node-fetch";

/** Build the request body for JSON-mode fact checking */
function buildBody({ claim, model }) {
  const system =
    "You are a careful fact-checker. Respond in strict JSON with keys:" +
    " verdict (True|False|Uncertain), confidence (0-100 integer)," +
    " summary (<=80 words), sources (3-6 canonical URLs).";

  const user =
    `Claim: ${claim}\n\nRules:\n` +
    "- Use web search & cite authoritative sources.\n" +
    "- confidence is a credibility percentage.\n" +
    "- Keep sources unique, no tracking parameters.\n";

  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" }, // JSON MODE
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  };
}

/** Try parsing the model content into JSON */
function parseAssistantJSON(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty model response");

  if (typeof content === "object") return content; // Already object

  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Failed to parse model JSON output.");
  }
}

/** Clean + dedupe source URLs */
function cleanSources(list) {
  if (!Array.isArray(list)) return [];

  const stripTrackers = (urlStr) => {
    try {
      const u = new URL(urlStr);
      const trackers = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content"
      ];
      trackers.forEach(p => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return null;
    }
  };

  const set = new Set();
  for (const x of list) {
    const cleaned = stripTrackers(x);
    if (cleaned) set.add(cleaned);
  }
  return Array.from(set);
}

/** Core call (OpenRouter or Perplexity) */
export async function callPerplexity({ claim, env }) {
  const provider = (env.PROVIDER || "perplexity").toLowerCase();

  console.log("[callPerplexity] provider:", provider);

  let baseURL, apiKey, model;
  const headers = { "Content-Type": "application/json" };

  if (provider === "openrouter") {
    baseURL = env.OPENROUTER_BASE_URL || "https://openrouter.ai/api";
    apiKey = env.OPENROUTER_API_KEY;
    model = env.OPENROUTER_MODEL || "perplexity/sonar-pro-search";

    // Required headers for OpenRouter
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "AI New Authentication";
  } else {
    baseURL = env.PERPLEXITY_BASE_URL || "https://api.perplexity.ai";
    apiKey = env.PERPLEXITY_API_KEY;
    model = env.PERPLEXITY_MODEL || "sonar-pro";
  }

  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }

  headers["Authorization"] = `Bearer ${apiKey}`;

  const url = `${baseURL.replace(/\/+$/, "")}/chat/completions`;
  const body = buildBody({ claim, model });

  // ---- MAKE REQUEST ----
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  // ALWAYS read as text first
  const raw = await res.text();
  const short = raw.slice(0, 200).replace(/\s+/g, " ");
  const contentType = res.headers.get("content-type") || "";

  console.log("[callPerplexity] status:", res.status, "| content-type:", contentType);

  // ---- ERROR HANDLING ----
  if (!res.ok) {
    // Most common: HTML error page → invalid/expired API key
    if (short.startsWith("<!DOCTYPE") || short.startsWith("<html")) {
      throw new Error(
        `Provider ${provider} error ${res.status} — HTML error page returned. ` +
        `Likely invalid/expired API key or wrong endpoint.`
      );
    }

    // Try parsing JSON error
    try {
      const errJson = JSON.parse(raw);
      throw new Error(
        `Provider ${provider} error ${res.status}: ` +
        `${errJson.error?.message || raw}`
      );
    } catch {
      throw new Error(
        `Provider ${provider} error ${res.status}: ${short}`
      );
    }
  }

  // Even 200 OK but still HTML (misconfigured endpoint)
  if (!/application\/json/i.test(contentType)) {
    if (short.startsWith("<!DOCTYPE") || short.startsWith("<html")) {
      throw new Error(
        `Provider ${provider} returned HTML with 2xx (unexpected). ` +
        `First bytes: ${short}`
      );
    }
  }

  // ---- PARSE JSON ----
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse JSON from provider ${provider}. Content: ${short}`
    );
  }

  // Format response
  const parsed = parseAssistantJSON(data);

  let verdict = parsed.verdict || "Uncertain";
  if (!["True", "False", "Uncertain"].includes(verdict)) verdict = "Uncertain";

  let confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const summary = parsed.summary || "";
  const sources = cleanSources(parsed.sources || []);

  return { verdict, confidence, summary, sources };
}
