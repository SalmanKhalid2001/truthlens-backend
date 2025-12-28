import fetch from "node-fetch";

function sanitizeQuery(q) {
  if (!q) return "";
  const cleaned = String(q)
    .replace(/[^\p{L}\p{N}\s'".,:-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `"${cleaned}"` : "";
}

export async function searchGNews(query, { apiKey, lang = "en", max = 5 } = {}) {
  if (!apiKey) {
    console.warn("[GNews] Missing API key!");
    return [];
  }

  const q = sanitizeQuery(query);
  if (!q) return [];

  const params = new URLSearchParams({
    q,
    lang: lang || "en",
    max: String(max || 5),
  });

  const url = `https://gnews.io/api/v4/search?${params.toString()}&apikey=${apiKey}`;

  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    console.warn("[GNews] HTTP", res.status, text.slice(0, 200));
    return [];
  }

  let data;
  try { data = JSON.parse(text); }
  catch {
    console.warn("[GNews] Invalid JSON:", text.slice(0, 200));
    return [];
  }

  const articles = Array.isArray(data.articles) ? data.articles : [];
  return articles.map(a => ({
    title: a.title,
    url: a.url,
    source: a.source?.name,
    publishedAt: a.publishedAt
  }));
}
