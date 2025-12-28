import fetch from "node-fetch";

function cleanSources(list) {
  if (!Array.isArray(list)) return [];
  const trackers = ["utm_source","utm_medium","utm_campaign","utm_term","utm_content"];
  const out = new Set();
  for (const s of list) {
    try {
      const u = new URL(String(s));
      trackers.forEach(p => u.searchParams.delete(p));
      out.add(u.toString());
    } catch {}
  }
  return Array.from(out);
}

async function postChat({ baseURL, apiKey, model, system, user, referer }) {
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": referer,
      Referer: referer,
      "X-Title": "AI New Authentication"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: "system", content: system.trim() },
        { role: "user", content: user.trim() }
      ]
    })
  });
  const text = await res.text();
  return { res, text };
}

export async function callLLM({ claim, wiki, news, env }) {
  const baseURL = (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/+$/,"");
  const apiKey  = (env.OPENROUTER_API_KEY || "").trim();
  const prefer  = (env.OPENROUTER_MODEL || "").trim() || "openrouter/auto";
  const referer = env.APP_PUBLIC_URL?.trim() || "http://localhost";

  console.log("[callLLM] start → provider=openrouter");
  console.log("[callLLM] baseURL:", baseURL);
  console.log("[callLLM] model   :", prefer);
  console.log("[callLLM] key?    :", apiKey ? `YES (${apiKey.slice(0,8)}…${apiKey.slice(-6)})` : "NO");
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  const system = `
You are a misinformation fact-checker. Return STRICT JSON only:
{"verdict":"True|False|Uncertain","confidence":0-100,"summary":"<=80 words","sources":["https://..."]}
Prefer major outlets (Reuters/AP/BBC/Dawn/Geo). Do not hallucinate citations.
If a death/jail rumor lacks >=2 reputable confirmations, do not mark True.
`;

  const user = `
Claim:
${claim}

Wikipedia:
${wiki ? JSON.stringify(wiki) : "none"}

News (GNews):
${Array.isArray(news) ? JSON.stringify(news.slice(0,5)) : "none"}
`;

  const tryModels = [prefer, "openrouter/auto"].filter((v,i,self)=>self.indexOf(v)===i);
  let lastErr = null, content = null;

  for (const model of tryModels) {
    try {
      console.log("[callLLM] POST", `${baseURL}/chat/completions`, "→", model);
      const { res, text } = await postChat({ baseURL, apiKey, model, system, user, referer });
      console.log("[callLLM] HTTP", res.status);

      if (!res.ok) {
        const isBadModel =
          (res.status === 400 || res.status === 404) &&
          /not a valid model id|no endpoints found/i.test(text);
        if (isBadModel && model !== "openrouter/auto") {
          console.warn("[callLLM] model unavailable:", text.slice(0,200));
          lastErr = new Error(text);
          continue; // try fallback
        }
        let msg = text;
        try { msg = JSON.parse(text)?.error?.message || msg; } catch {}
        throw new Error(`OpenRouter error ${res.status}: ${msg}`);
      }

      let outer;
      try { outer = JSON.parse(text); }
      catch { throw new Error("LLM returned invalid response (outer JSON)."); }

      content = outer?.choices?.[0]?.message?.content || "{}";
      break; // success
    } catch (e) {
      lastErr = e;
    }
  }

  if (content == null) throw lastErr || new Error("LLM failed without error content.");

  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { verdict:"Uncertain", confidence:40, summary:"Could not parse model JSON.", sources:[] };
  }

  const verdict = ["True","False","Uncertain"].includes(parsed.verdict) ? parsed.verdict : "Uncertain";
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed.confidence) || 0)));
  const summary = String(parsed.summary || "").slice(0, 600);
  const sources = cleanSources(parsed.sources || []);

  console.log("[callLLM] done →", verdict, confidence, `${sources.length} src`);
  return { verdict, confidence, summary, sources };
}
