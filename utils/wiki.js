import fetch from "node-fetch";

const UA = "AI-New-Authentication/0.1 (https://localhost; contact@example.com)";

export async function searchWikipediaTopTitle(query) {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "1",
    format: "json",
    origin: "*"
  });
  const url = `https://en.wikipedia.org/w/api.php?${params.toString()}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = await res.json();
  const title = data?.query?.search?.[0]?.title;
  return title || null;
}

export async function getWikipediaSummaryByTitle(title) {
  const enc = encodeURIComponent(title);
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.content_urls?.desktop?.page) return null;
  return {
    title: data.title,
    extract: data.extract,
    url: data.content_urls.desktop.page
  };
}