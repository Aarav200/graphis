// Vercel serverless function for the research assistant chatbot.
// Keys come only from server environment variables — never from the client.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, context } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing 'message'" });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GEMINI_KEY && !GROQ_KEY) {
    return res.status(500).json({ error: "No API key configured on the server." });
  }

  const prompt = `
You are Graphis's research assistant. You help a researcher understand their uploaded documents, the knowledge graph built from them, and potential collaborators.

Here is the researcher's current document context (entities extracted from their uploads and field relevance scores):
${JSON.stringify(context || [], null, 2)}

Answer the researcher's question below concisely and helpfully, referencing their actual documents/entities where relevant. If the context is empty, tell them to upload documents first.

Question: ${message}
`.trim();

  try {
    let reply;
    try {
      reply = GEMINI_KEY ? await callGemini(prompt, GEMINI_KEY) : await callGroq(prompt, GROQ_KEY);
    } catch (err) {
      if (GEMINI_KEY && GROQ_KEY) reply = await callGroq(prompt, GROQ_KEY);
      else throw err;
    }
    return res.status(200).json({ reply });
  } catch (err) {
    return res.status(502).json({ error: "Chat failed: " + err.message });
  }
}

async function callGemini(prompt, key) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  if (!resp.ok) throw new Error(`Gemini chat error ${resp.status}`);
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "I couldn't generate a reply.";
}

async function callGroq(prompt, key) {
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: prompt }] })
  });
  if (!resp.ok) throw new Error(`Groq chat error ${resp.status}`);
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "I couldn't generate a reply.";
}
