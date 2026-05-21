export async function getZoyaResponse(prompt: string): Promise<string> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.reply;
  } catch (error) {
    console.error("Failed to query Gemini backend:", error);
    return "Uff, mera dimaag kharab ho gaya hai backend par. Try again later, Ashwani.";
  }
}

export async function getZoyaAudio(text: string): Promise<string | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.audio || null;
  } catch (error) {
    console.error("Failed to fetch TTS from backend:", error);
    return null;
  }
}

export async function getSavedMessages() {
  try {
    const res = await fetch("/api/messages");
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (error) {
    console.error("Failed to load conversation history:", error);
    return [];
  }
}

export async function clearSavedMessages() {
  try {
    const res = await fetch("/api/chat/clear", { method: "POST" });
    return res.ok;
  } catch (error) {
    console.error("Failed to clear history on backend:", error);
    return false;
  }
}

export function resetZoyaSession() {
  // Let's call the backend to reset or clear as optional
}
