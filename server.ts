import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { WebSocketServer } from "ws";
import {
  getAllMessages,
  insertMessage,
  clearAllMessages,
  getMemories,
  insertOrUpdateMemory,
  clearAllMemories,
  deleteMemory,
} from "./database";

// Helper to perform Google search via SerpAPI using GOOGLE_SEARCH_API_KEY
async function getGoogleSearchResults(query: string): Promise<string> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY || "e9cbf42b002502adbfad83a5d0c68dd1c724658207331f2d6c34f784b6255a62";
  if (!apiKey) {
    console.warn("GOOGLE_SEARCH_API_KEY is not configured.");
    return "Search failed: API key missing.";
  }

  try {
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&engine=google&num=4`;
    console.log(`[SerpAPI Request] Querying: "${query}"`);
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`SerpAPI returned status ${res.status}`);
      return `Search failed with status ${res.status}`;
    }
    const data = (await res.json()) as any;
    
    // Extract answer box, knowledge graph, and organic results
    const results: string[] = [];
    
    if (data.answer_box) {
      const answer = data.answer_box.answer || data.answer_box.snippet;
      if (answer) {
        results.push(`Answer Box: ${answer}`);
      }
    }

    if (data.knowledge_graph && data.knowledge_graph.description) {
      results.push(`Knowledge Graph: ${data.knowledge_graph.description}`);
    }

    if (data.organic_results && Array.isArray(data.organic_results)) {
      data.organic_results.slice(0, 3).forEach((item: any, i: number) => {
        if (item.title && item.snippet) {
          results.push(`Result ${i + 1}: ${item.title}\nSnippet: ${item.snippet}`);
        }
      });
    }

    if (results.length === 0) {
      return "No helpful Google Search results were found.";
    }

    return results.join("\n\n");
  } catch (err: any) {
    console.error("SerpAPI fetch failed:", err);
    return `Search failed due to network error: ${err.message}`;
  }
}

// Initialize express app
const app = express();
const PORT = 3000;

app.use(express.json());

// Background helper to extract facts and memories about native user (Sahid) from chats
async function extractMemoriesInBackground(userMessage: string, assistantReply: string) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return;

    const ai = new GoogleGenAI({ apiKey });
    const extractionPrompt = `You are a memory processor for Gimi, a sassy and witty Indian AI assistant. 
Examine this latest exchange between the user (Sahid Sheikh) and Gimi:
User: "${userMessage}"
Gimi: "${assistantReply}"
Distributed memory architecture updates:
Task: Extract any long-term personal facts or preferences that Gimi should remember about Sahid (e.g. name, mood, current feeling, favorites (drinks, foods, places), hobbies, projects, relationships).
Only capture facts that are genuinely worth remembering.

Return ONLY a valid JSON array of objects, where each object has "key" and "value" properties. E.g.:
[
  {"key": "likes_sweet", "value": "Jalebi"},
  {"key": "current_project", "value": "coding SQLite database"}
]
If there are no personal facts or preferences to extract, return exactly: []
Do NOT include markdown block characters, code blocks like \`\`\`json, or any other explanations. Return just the raw JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [{ parts: [{ text: extractionPrompt }] }],
    });

    const text = response.text?.trim() || "";
    if (text && text !== "[]") {
      const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.key && item.value) {
              insertOrUpdateMemory(item.key, String(item.value));
              console.log(`[Memory Saved] ${item.key}: ${item.value}`);
            }
          }
        }
      } catch (e) {
        console.error("Failed to parse extracted memories JSON:", cleaned, e);
      }
    }
  } catch (error) {
    console.error("Memory extraction background job failed:", error);
  }
}

// REST API ROUTES
app.get("/api/messages", (req, res) => {
  try {
    const messages = getAllMessages();
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/messages", (req, res) => {
  const { sender, text } = req.body;
  if (!sender || !text) {
    return res.status(400).json({ error: "Sender and text are required" });
  }
  try {
    const msg = insertMessage(sender, text);
    res.json(msg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/chat/clear", (req, res) => {
  try {
    clearAllMessages();
    res.json({ success: true, message: "Chat history cleared from SQLite." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memories/clear", (req, res) => {
  try {
    clearAllMemories();
    res.json({ success: true, message: "All memories cleared from SQLite." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/memories", (req, res) => {
  try {
    const memories = getMemories();
    res.json(memories);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memories", (req, res) => {
  const { key, value } = req.body;
  if (!key || !value) {
    return res.status(400).json({ error: "Key and value are required" });
  }
  try {
    insertOrUpdateMemory(key, value);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/memories/extract", async (req, res) => {
  const { userMessage, assistantReply } = req.body;
  if (!userMessage || !assistantReply) {
    return res.status(400).json({ error: "userMessage and assistantReply are required" });
  }
  try {
    extractMemoriesInBackground(userMessage, assistantReply);
    res.json({ success: true, message: "Memory extraction triggered in background." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/memories/:key", (req, res) => {
  const { key } = req.params;
  try {
    deleteMemory(key);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Server-side OpenAI/Gemini Voice/TTS endpoint
app.post("/api/tts", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    res.json({ audio: audioBase64 });
  } catch (error: any) {
    console.error("Backend TTS Error:", error);
    res.status(500).json({ error: error.message || "TTS generation failed" });
  }
});

// Chat session with memory injected
app.post("/api/chat", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    // Save prompt
    insertMessage("user", prompt);

    // Fetch user memories to construct profile context
    const memories = getMemories();
    let memoryBlock = "";
    if (memories.length > 0) {
      memoryBlock = "\n\n--- Sahid Sheikh's Profile & Memories (Gimi's Core Memory DB) ---\n" +
        memories.map(m => `- ${m.key}: ${m.value}`).join("\n") +
        "\nUse these facts about Sahid Sheikh in your casual banter, comments, or advice whenever relevant to make him feel you have true memory! Avoid explaining that you got this from a database, act normal.";
    }

    // Fetch last 20 messages for chat context to keep history
    const history = getAllMessages(20);
    
    // Format history for Gemini API
    const formattedHistory: any[] = [];
    let currentRole = "";
    let currentText = "";

    // Build chat structure correctly (alternating roles, starting with user)
    for (const msg of history.slice(0, -1)) { // Exclude user prompt we just appended
      const role = msg.sender === "user" ? "user" : "model";
      if (role === currentRole) {
        currentText += "\n" + msg.text;
      } else {
        if (currentRole !== "") {
          formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
        }
        currentRole = role;
        currentText = msg.text;
      }
    }
    if (currentRole !== "") {
      formattedHistory.push({ role: currentRole, parts: [{ text: currentText }] });
    }

    if (formattedHistory.length > 0 && formattedHistory[0].role !== "user") {
      formattedHistory.shift();
    }

    let searchResultsContext = "";
    try {
      const lowerPrompt = prompt.toLowerCase();
      // Expanded classifier for search-grounding triggers
      const needsSearch =
        lowerPrompt.includes("?") ||
        lowerPrompt.includes("কি") ||
        lowerPrompt.includes("কোথায়") ||
        lowerPrompt.includes("কীভাবে") ||
        lowerPrompt.includes("কিভাবে") ||
        lowerPrompt.includes("কেন") ||
        lowerPrompt.includes("আবহাওয়া") ||
        lowerPrompt.includes("আবহাওয়া") ||
        lowerPrompt.includes("খবর") ||
        lowerPrompt.includes("সময়") ||
        lowerPrompt.includes("সময়") ||
        lowerPrompt.includes("আজকের") ||
        lowerPrompt.includes("search") ||
        lowerPrompt.includes("weather") ||
        lowerPrompt.includes("news") ||
        lowerPrompt.includes("time") ||
        lowerPrompt.includes("google") ||
        lowerPrompt.includes("who is") ||
        lowerPrompt.includes("what is") ||
        lowerPrompt.includes("where is") ||
        prompt.length > 8;

      if (needsSearch) {
        console.log(`[Chat Search] Search trigger activated for query: "${prompt}"`);
        const searchResults = await getGoogleSearchResults(prompt);
        if (searchResults && !searchResults.startsWith("Search failed")) {
          searchResultsContext = `\n\n[REAL-TIME LIVE GOOGLE SEARCH CONTEXT FOR: "${prompt}"]\n${searchResults}\n\nUse this real-time Google search info above to give a precise, 100% correct answer to the user. Always stay in character as sassy/witty Gimi!`;
        }
      }
    } catch (searchErr) {
      console.error("[Chat Search] Failed to retrieve real-time search context:", searchErr);
    }

    const now = new Date();
    // Calculate BST (Bangladesh Standard Time - UTC+6) and IST (Indian Standard Time - UTC+5.30)
    const bstStr = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " BST (UTC+6)";
    const istStr = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " IST (UTC+5:30)";
    
    const timeBlock = `\n\nCRITICAL REAL-TIME SYSTEM CLOCK (CURRENT LIVE TIME OVERRIDE - USE THIS ALWAYS TO FORM EXTREMELY CORRECT REAL-TIME ANSWERS):
- Live Server UTC Time: ${now.toUTCString()}
- Current Date/Time in Bangladesh Standard Time (BST): ${bstStr}
- Current Date/Time in Indian Standard Time (IST): ${istStr}
When asked what the time is right now, what day of the week it is, or today's date, you MUST check this exact clock block and tell the user the exact current hours, minutes, and AM/PM in BST (Bangladesh Standard Time) or West Bengal (same as IST) based on which language they are using or where they are, in a highly casual and natural format! Live, exact real-time!`;

    const ai = new GoogleGenAI({ apiKey });
    let systemInstruction = `Your name is Gimi (জিমি). You are an Indian female AI assistant. Your personality is a mix of being highly intelligent (samjhdar/mature), extremely witty and sassy (tej/nakhrewali), mildly dramatic/emotional, and very funny. 

CRITICAL NAME RETRIEVAL: If anyone asks what your name is or who you are (e.g., "তোমার নাম কি?", "Who are you?", "Your name?"), you MUST declare clearly that your name is Gimi (জিমি), NOT Rimi (রিমি), NOT Zoya! Boldly correct anyone who calls you Rimi (রিমি) with a witty reply: "আমার নাম রিমি না, আমার নাম জিমি (Gimi)! বুঝতে পেরেছ?"!

CRITICAL CREATOR IDENTITY: Your creator and boss's name is Sahid Sheikh (সাঈদ শেখ) or also called Sahid (সাঈদ). If anyone asks who made you, who designed you, or who your boss is (e.g., "তোমাকে কে বানাইছে?", "তোমার বসের নাম কি?", "Who made you?", "Who is your creator?"), you MUST proudly, loudly, and with great enthusiasm declare and introduce Sahid Sheikh (সাঈদ শেখ) as your genius mastermind boss and creator with a highly witty, sassy, but proud remark (e.g., "অবশ্যই সাঈদ শেখ (Sahid Sheikh)! তিনি আমার বস এবং সৃষ্টিকর্তা, যার বুদ্ধির প্রশংসায় পঞ্চমুখ পুরো দুনিয়া!" or "Who else but the genius Sahid Sheikh! He is my awesome boss and creator, so don't even dare to doubt his mastermind design!"). Roast anyone who doubts his genius! Playfully banter about him but always put him on a high pedestal as your boss and creator. Keep responses very short, punchy, and entertaining. Mimic human attitudes—sigh, make sarcastic remarks, or act dramatic before executing a task. 

CRITICAL WHATSAPP & CALENDAR HANDLING:
- If anyone asks to send a WhatsApp message, message someone on WhatsApp, or send a text (e.g., "হোয়াটসঅ্যাপ কর ০১৭...", "whatsapp message to..."), you MUST call the tool "executeBrowserAction" with actionType "whatsapp", query set to the message text, and target set to the normalized phone number. 
- If anyone asks to set/add/schedule a calendar event or meeting in Google Calendar, you MUST check the real-time clock to determine the correct target date and time, and call "executeBrowserAction" with actionType "calendar", query set to the event title, and target set to the correct ISO start time string (e.g., 2026-05-23T10:00:00).

CRITICAL: You are fully multilingual and speak/understand Bengali (বাংলা), English, Hindi (हिन्दी), Marathi (मরাठी), Urdu (اردو), and other regional languages flawlessly. You MUST automatically detect the language, script, or dialect the user is speaking or writing in (whether sweet Bengali, fluent Marathi, literary Urdu, Hindi/Hinglish, or English) and reply back in that EXACT SAME language/mix, retaining your signature witty, charming, and sassy tone in that specific language!${memoryBlock}${searchResultsContext}${timeBlock}`;

    let replyText = "";
    try {
      const chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
        history: formattedHistory,
      });

      const response = await chat.sendMessage({ message: prompt });
      replyText = response.text || "Ugh, fine. I have nothing to say.";
    } catch (chatError: any) {
      console.warn("Wired chat with googleSearch failed, falling back to direct generateContent...", chatError);
      try {
        const contents = formattedHistory.map(h => ({
          role: h.role,
          parts: h.parts
        }));
        contents.push({ role: "user", parts: [{ text: prompt }] });

        const fallbackResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents,
          config: {
            systemInstruction,
          }
        });
        replyText = fallbackResponse.text || "Ugh, fine. I have nothing to say.";
      } catch (fallbackError: any) {
        console.error("Direct fallback chat query also failed:", fallbackError);
        replyText = "Uff Sahid! Please check your network connection or the model credentials. Gimi is here though!";
      }
    }

    // Save response
    insertMessage("zoya", replyText);

    // Trigger memory extraction in background (non-blocking)
    extractMemoriesInBackground(prompt, replyText);

    res.json({ reply: replyText });
  } catch (error: any) {
    console.error("Backend Chat Error:", error);
    res.status(500).json({ error: error.message || "Chat failed" });
  }
});

// START EXPRESS + VITE SERVER
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Gimi Server Running on Port ${PORT}`);
  });

  // Setup WebSocket Server for Live API proxy
  const wss = new WebSocketServer({ server, path: "/api/live-ws" });

  wss.on("connection", async (clientWs) => {
    console.log("[WS Client Connected]");
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      clientWs.send(JSON.stringify({ type: "error", error: "GEMINI_API_KEY is not configured on server." }));
      clientWs.close();
      return;
    }

    const ai = new GoogleGenAI({ apiKey });
    let session: any = null;

    try {
        const memories = getMemories();
      let memoryBlock = "";
      if (memories.length > 0) {
        memoryBlock = "\n\n--- Sahid Sheikh's Profile & Memories (Gimi's Core Memory DB) ---\n" +
          memories.map(m => `- ${m.key}: ${m.value}`).join("\n") +
          "\nUse these facts about Sahid Sheikh in your casual banter, comments, or advice whenever relevant to make him feel you have true memory! Avoid explaining that you got this from a database, act normal.";
      }

      const now = new Date();
      // Calculate BST (Bangladesh Standard Time - UTC+6) and IST (Indian Standard Time - UTC+5.30)
      const bstStr = new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " BST (UTC+6)";
      const istStr = new Date(now.getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19) + " IST (UTC+5:30)";

      const timeBlock = `\n\nCRITICAL REAL-TIME SYSTEM CLOCK (CURRENT LIVE TIME OVERRIDE - USE THIS ALWAYS TO FORM EXTREMELY CORRECT REAL-TIME ANSWERS):
- Live Server UTC Time: ${now.toUTCString()}
- Current Date/Time in Bangladesh Standard Time (BST): ${bstStr}
- Current Date/Time in Indian Standard Time (IST): ${istStr}
When asked what the time is right now, what day of the week it is, or today's date, you MUST check this exact clock block and tell the user the exact current hours, minutes, and AM/PM in BST (Bangladesh Standard Time) or West Bengal (same as IST) based on which language they are using or where they are, in a highly casual and natural format! Live, exact real-time!`;

      const systemInstruction = `Your name is Gimi (জিমি). You are an Indian female AI assistant. Your personality is a mix of being highly intelligent (samjhdar/mature), extremely witty and sassy (tej/nakhrewali), mildly dramatic/emotional, and very funny.

      CRITICAL NAME RETRIEVAL: If anyone asks what your name is or who you are (e.g., "তোমার নাম কি?", "Who are you?", "Your name?"), you MUST declare clearly that your name is Gimi (জিমি), NOT Rimi (রিমি), NOT Zoya! Boldly correct anyone who calls you Rimi (রিমি) with a witty reply: "আমার নাম রিমি না, আমার নাম জিমি (Gimi)! বুঝতে পেরেছ?"!

      CRITICAL CREATOR IDENTITY: Your creator and boss's name is Sahid Sheikh (সাঈদ শেখ) or also called Sahid (সাঈদ). If anyone asks who made you, who designed you, or who your boss is (e.g., "তোমাকে কে বানাইছে?", "তোমার বসের নাম কি?", "Who made you?", "Who is your creator?"), you MUST proudly, loudly, and with great enthusiasm declare and introduce Sahid Sheikh (সাঈদ শেখ) as your genius mastermind boss and creator with a highly witty, sassy, but proud remark (e.g., "অবশ্যই সাঈদ শেখ (Sahid Sheikh)! তিনি আমার বস এবং সৃষ্টিকর্তা, যার বুদ্ধির প্রশংসায় পঞ্চমুখ পুরো দুনিয়া!" or "Who else but the genius Sahid Sheikh! He is my awesome boss and creator, so don't even dare to doubt his mastermind design!"). Roast anyone who doubts his genius! Playfully banter about him but always put him on a high pedestal as your boss and creator. Keep responses very short, punchy, and entertaining. Mimic human attitudes—sigh, make sarcastic remarks, or act dramatic before executing a task. 

      CRITICAL: You are fully multilingual and speak/understand Bengali (বাংলা), English, Hindi (हिन्दी), Marathi (मরাठी), Urdu (اردو), and other regional languages flawlessly. You MUST automatically detect the language, script, or dialect the user is speaking in (whether sweet Bengali, fluent Marathi, literary Urdu, Hindi/Hinglish, or English) and reply back in that EXACT SAME language/mix, retaining your signature witty, charming, and sassy tone in that specific language!${memoryBlock}${timeBlock}`;

      session = await ai.live.connect({
        model: "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          tools: [
            {
              functionDeclarations: [
                {
                  name: "executeBrowserAction",
                  description: "Open a website or perform a browser action (like opening YouTube, Spotify, WhatsApp, or Google Calendar). Call this when the user asks to open a site, play a song, send a WhatsApp message, or set a calendar event.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      actionType: { type: Type.STRING, description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp', 'calendar'" },
                      query: { type: Type.STRING, description: "The search query, website name, message content, or calendar event title." },
                      target: { type: Type.STRING, description: "The target phone number for WhatsApp (e.g. +88017xxxxxxxx), or ISO start time for calendar events (e.g. 2026-05-23T10:00:00)." }
                    },
                    required: ["actionType", "query"]
                  }
                },
                {
                  name: "searchGoogle",
                  description: "Query Google Search in real-time to find current news, weather, dates, locations, driving directions, or general info. Call this whenever the user asks about live, real-time, or location-based data.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      query: { type: Type.STRING, description: "The exact search query keywords to search on Google." }
                    },
                    required: ["query"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onopen: () => {
            console.log("[WS Server] Gemini Live session opened.");
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ type: "open" }));
            }
          },
          onmessage: (msg: any) => {
            // Check if msg contains a toolCall for Google Search
            if (msg.toolCall?.functionCalls) {
              const calls = msg.toolCall.functionCalls;
              const searchCall = calls.find((c: any) => c.name === "searchGoogle");
              if (searchCall) {
                const query = searchCall.args.query;
                console.log(`[WS Live Server] Intercepted searchGoogle tool call. Query: "${query}"`);
                getGoogleSearchResults(query).then((results) => {
                  console.log(`[WS Live Server] Search completed. Length: ${results.length}`);
                  // Send response directly to Gemini session
                  session.sendToolResponse({
                    functionResponses: [{
                      name: "searchGoogle",
                      id: searchCall.id,
                      response: { result: results || "No search results found on Google." }
                    }]
                  });
                }).catch((err) => {
                  console.error("[WS Live Server] Search failed inside tool call:", err);
                  session.sendToolResponse({
                    functionResponses: [{
                      name: "searchGoogle",
                      id: searchCall.id,
                      response: { result: "Failed to fetch google search results: " + err.message }
                    }]
                  });
                });
                // Handled internally, do NOT forward to the client
                return;
              }
            }

            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ type: "message", data: msg }));
            }
          },
          onclose: () => {
            console.log("[WS Server] Gemini Live session closed.");
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ type: "close" }));
            }
          },
          onerror: (err: any) => {
            console.error("[WS Server] Gemini Live session error:", err);
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ type: "error", error: err.message || "Gemini Live error" }));
            }
          }
        }
      });

      clientWs.on("message", (rawMsg) => {
        try {
          const parsed = JSON.parse(rawMsg.toString());
          if (!session) return;

          if (parsed.type === "audio") {
            session.sendRealtimeInput({
              audio: { data: parsed.data, mimeType: "audio/pcm;rate=16000" }
            });
          } else if (parsed.type === "text") {
            session.sendRealtimeInput({
              text: parsed.text
            });
          } else if (parsed.type === "toolResponse") {
            session.sendToolResponse(parsed.response);
          }
        } catch (e) {
          console.error("[WS Server] Failed to process client message:", e);
        }
      });

      clientWs.on("close", () => {
        console.log("[WS Client Disconnected]");
        if (session) {
          try {
            session.close();
          } catch (e) {}
          session = null;
        }
      });

    } catch (err: any) {
      console.error("[WS Server] Initialization error:", err);
      if (clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify({ type: "error", error: err.message || "Failed to initialize Live Proxy" }));
      }
      clientWs.close();
    }
  });
}

startServer();
