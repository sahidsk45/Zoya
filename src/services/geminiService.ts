const DEFAULT_API_KEY = "AIzaSyBVPpkdLrg32-UJm3qpihbWKAKV8ffAAA8";

function getApiKey(): string {
  return import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem("ZOYA_API_KEY") || DEFAULT_API_KEY;
}

// Low-level LocalStorage database helper for Vercel/Static deployments
interface LocalMessage {
  id: string;
  sender: "user" | "zoya";
  text: string;
  timestamp: number;
}

interface LocalMemory {
  id: string;
  key: string;
  value: string;
  extracted_at: number;
}

function getLocalMessages(): LocalMessage[] {
  try {
    const data = localStorage.getItem("zoya_local_messages");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalMessages(msgs: LocalMessage[]) {
  try {
    localStorage.setItem("zoya_local_messages", JSON.stringify(msgs));
  } catch (e) {}
}

function getLocalMemories(): LocalMemory[] {
  try {
    const data = localStorage.getItem("zoya_local_memories");
    return data ? JSON.parse(data) : [];
  } catch (e) {
    return [];
  }
}

function saveLocalMemories(mems: LocalMemory[]) {
  try {
    localStorage.setItem("zoya_local_memories", JSON.stringify(mems));
  } catch (e) {}
}

// Client-side Memory Extractor
async function extractMemoriesClientSide(userMsg: string, zoyaReply: string) {
  try {
    const apiKey = getApiKey();
    const prompt = `You are a memory processor for Gimi, a sassy and witty Indian AI assistant. 
Examine this latest exchange between the user (Sahid Sheikh) and Gimi:
User: "${userMsg}"
Gimi: "${zoyaReply}"

Task: Extract any long-term personal facts or preferences that Gimi should remember about Sahid (e.g. name, mood, current feeling, favorites (drinks, foods, places), hobbies, projects, relationships).
Only capture facts that are genuinely worth remembering.

Return ONLY a valid JSON array of objects, where each object has "key" and "value" properties. E.g.:
[
  {"key": "likes_sweet", "value": "Jalebi"},
  {"key": "current_project", "value": "coding SQLite database"}
]
If there are no personal facts or preferences to extract, return exactly: []
Do NOT include markdown block characters, code blocks like \`\`\`json, or any other explanations. Return just the raw JSON.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!res.ok) return;
    const data = await res.json();
    const txt = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    if (txt && txt !== "[]") {
      const cleaned = txt.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          let currentMems = getLocalMemories();
          for (const item of parsed) {
            if (item.key && item.value) {
              const k = String(item.key).toLowerCase();
              const existingIndex = currentMems.findIndex(m => m.key === k);
              const newMem: LocalMemory = {
                id: Date.now().toString() + "-" + Math.random().toString(36).substr(2, 4),
                key: k,
                value: String(item.value),
                extracted_at: Date.now()
              };
              if (existingIndex > -1) {
                currentMems[existingIndex] = newMem;
              } else {
                currentMems.push(newMem);
              }
              console.log(`[Local Memory Saved] ${k}: ${item.value}`);
            }
          }
          saveLocalMemories(currentMems);
        }
      } catch (e) {}
    }
  } catch (err) {
    console.error("Client-side memory extractor failed:", err);
  }
}

// Main dual-mode APIs
export async function getZoyaResponse(prompt: string): Promise<string> {
  // 1. Try Express server backend
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data && data.reply) {
          return data.reply;
        }
      }
    }
  } catch (error) {
    console.warn("Express backend /api/chat unreachable, falling back to direct client-side Gemini call.", error);
  }

  // 2. Fall back to Direct Client-side call to Google Gemini APIs
  try {
    const apiKey = getApiKey();
    const localMsgs = getLocalMessages();
    
    // Track user message locally
    const userMsgObj: LocalMessage = {
      id: Date.now().toString() + "-user",
      sender: "user",
      text: prompt,
      timestamp: Date.now()
    };
    const updatedMsgs = [...localMsgs, userMsgObj];
    saveLocalMessages(updatedMsgs);

    // Build context with profile memories
    const memories = getLocalMemories();
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

CRITICAL: You are fully multilingual and speak/understand Bengali (বাংলা), English, Hindi (हिन्दी), Marathi (मраठी), Urdu (اردو), and other regional languages flawlessly. You MUST automatically detect the language, script, or dialect the user is speaking or writing in (whether sweet Bengali, fluent Marathi, literary Urdu, Hindi/Hinglish, or English) and reply back in that EXACT SAME language/mix, retaining your signature witty, charming, and sassy tone in that specific language!${memoryBlock}${timeBlock}`;

    // Format chat history for raw Gemini API structure
    // Retain up to 20 messages for context
    const recentHistory = updatedMsgs.slice(-20);
    const contents: any[] = [];
    let currentRole = "";
    let currentText = "";

    // Build alternating user/model turns starting with "user"
    for (const msg of recentHistory) {
      const role = msg.sender === "user" ? "user" : "model";
      if (role === currentRole) {
        currentText += "\n" + msg.text;
      } else {
        if (currentRole !== "") {
          contents.push({ role: currentRole, parts: [{ text: currentText }] });
        }
        currentRole = role;
        currentText = msg.text;
      }
    }
    if (currentRole !== "") {
      contents.push({ role: currentRole, parts: [{ text: currentText }] });
    }

    // Direct fetch to Gemini API
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Direct Gemini API HTTP error: ${response.status}`);
    }

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Ugh, fine. I have nothing to say.";

    // Track zoya response locally
    const zoyaMsgObj: LocalMessage = {
      id: (Date.now() + 1).toString() + "-zoya",
      sender: "zoya",
      text: replyText,
      timestamp: Date.now()
    };
    saveLocalMessages([...updatedMsgs, zoyaMsgObj]);

    // Perform background memory extraction client-side
    extractMemoriesClientSide(prompt, replyText);

    return replyText;
  } catch (error) {
    console.error("Direct fallback client-side Gemini query failed:", error);
    return "Uff, checking direct internet connection. Make sure the API key is valid or try again, Sahid.";
  }
}

export async function getZoyaAudio(text: string): Promise<string | null> {
  // 1. Try Express server backend
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data && data.audio) {
          return data.audio;
        }
      }
    }
  } catch (error) {
    console.warn("Express backend /api/tts unreachable, falling back to direct client-side TTS.", error);
  }

  // 2. Fallback to Direct Client-side TTS call to Google Gemini APIs
  try {
    const apiKey = getApiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: "Kore" }
            }
          }
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Direct TTS HTTP error: ${response.status}`);
    }

    const data = await response.json();
    const audioBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    return audioBase64;
  } catch (error) {
    console.error("Direct fallback client-side TTS failed:", error);
    return null;
  }
}

export async function getSavedMessages() {
  // 1. Try Express backend
  try {
    const res = await fetch("/api/messages");
    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return await res.json();
      }
    }
  } catch (error) {
    console.warn("Express backend messages API unreachable, returning client-side local messages list.", error);
  }

  // 2. Return local messages
  return getLocalMessages();
}

export async function clearSavedMessages() {
  // 1. Try Express backend
  try {
    const res = await fetch("/api/chat/clear", { method: "POST" });
    if (res.ok) {
      return true;
    }
  } catch (error) {
    console.warn("Express backend clear chat endpoint failed, clearing client-side memory instead.", error);
  }

  // 2. Clear locally
  saveLocalMessages([]);
  return true;
}

export function resetZoyaSession() {
  // Option to reset local states or reload
}
