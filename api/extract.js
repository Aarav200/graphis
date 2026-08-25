// Vercel serverless function. Runs on Node — API keys read from environment
// variables only (set these in your Vercel project's Environment Variables,
// never in the frontend): GEMINI_API_KEY, and optionally GROQ_API_KEY as a
// fallback if the Gemini call fails or is rate-limited.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { filename, text, codeSymbols, fields } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Missing or invalid 'text' field" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROQ_KEY = process.env.GROQ_API_KEY;

  if (!GEMINI_KEY && !GROQ_KEY) {
    return res.status(500).json({ error: "No API key configured on the server. Set GEMINI_API_KEY (or GROQ_API_KEY) in Vercel environment variables." });
  }

  const fieldList = Array.isArray(fields) && fields.length ? fields : ["Computer Science", "Public Health", "Environmental Science", "Social Sciences", "Data Science", "Biology"];

  const schemaInstructions = `
You are analyzing an academic/technical document for a knowledge graph system.
Return ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape:

{
  "entities": [ { "name": string, "type": "paper"|"author"|"topic"|"dataset"|"method"|"finding", "description": string } ],
  "relationships": [ { "source": string, "target": string, "type": "cites"|"uses-same-dataset"|"same-topic"|"methodological-overlap"|"builds-on", "confidence": number (0-1), "justification": string } ],
  "fieldScores": { ${fieldList.map(f => `"${f}": number (0-100)`).join(", ")} }
}

Rules:
- Only assert a relationship if there is clear textual evidence in the document itself (e.g. an explicit citation or stated dataset/method reuse). If uncertain, omit it rather than guess.
- "source" and "target" in relationships must exactly match a "name" from the entities list.
- fieldScores reflect how relevant this document is to each listed field, 0-100, based on its actual content.
- Filename: ${filename || "unknown"}
${codeSymbols ? `- This is a code file. Detected functions: ${(codeSymbols.functions||[]).join(", ")}. Detected classes: ${(codeSymbols.classes||[]).join(", ")}. Detected imports: ${(codeSymbols.imports||[]).join(", ")}. Treat these as candidate entities where relevant.` : ""}

DOCUMENT TEXT:
"""
${text}
"""
`.trim();

  let extraction;
  try {
    extraction = GEMINI_KEY
      ? await callGeminiExtraction(schemaInstructions, GEMINI_KEY)
      : await callGroqExtraction(schemaInstructions, GROQ_KEY);
  } catch (primaryErr) {
    // fallback to the other provider if the first fails
    try {
      extraction = GROQ_KEY && GEMINI_KEY
        ? await callGroqExtraction(schemaInstructions, GROQ_KEY)
        : null;
      if (!extraction) throw primaryErr;
    } catch (fallbackErr) {
      return res.status(502).json({ error: "Extraction failed on all configured providers: " + fallbackErr.message });
    }
  }

  let embedding = [];
  if (GEMINI_KEY) {
    try { embedding = await callGeminiEmbedding(text, GEMINI_KEY); }
    catch (e) { embedding = pseudoEmbedding(text); }
  } else {
    embedding = pseudoEmbedding(text);
  }

  return res.status(200).json({ ...extraction, embedding });
}

async function callGeminiExtraction(prompt, key) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!resp.ok) throw new Error(`Gemini extraction error ${resp.status}`);
  const data = await resp.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return safeParseJson(raw);
}

async function callGroqExtraction(prompt, key) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" }
    })
  });
  if (!resp.ok) throw new Error(`Groq extraction error ${resp.status}`);
  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content || "{}";
  return safeParseJson(raw);
}

async function callGeminiEmbedding(text, key) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: { parts: [{ text: text.slice(0, 8000) }] } })
  });
  if (!resp.ok) throw new Error(`Gemini embedding error ${resp.status}`);
  const data = await resp.json();
  return data?.embedding?.values || [];
}

// Deterministic lightweight fallback so similarity/graph features still work
// even with no embedding-capable key configured.
function pseudoEmbedding(text) {
  const dims = 64;
  const vec = new Array(dims).fill(0);
  const words = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  words.forEach(w => {
    let h = 0;
    for (let i = 0; i < w.length; i++) h = (h * 31 + w.charCodeAt(i)) >>> 0;
    vec[h % dims] += 1;
  });
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

function safeParseJson(raw) {
  try {
    const cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "");
    return JSON.parse(cleaned);
  } catch {
    return { entities: [], relationships: [], fieldScores: {} };
  }
}
