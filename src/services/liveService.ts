import { processCommand } from "./commandService";

export class LiveSessionManager {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  
  // Audio playback state
  private playbackContext: AudioContext | null = null;
  private nextPlayTime: number = 0;
  private isPlaying: boolean = false;
  public isMuted: boolean = false;
  private useDirectGoogleWs: boolean = false;
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "zoya", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};
  public onClose: () => void = () => {};

  constructor() {
    // Zero-dependency client-side manager
  }

  async start() {
    try {
      this.onStateChange("processing");
      
      // Initialize Audio Contexts
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioContextClass({ sampleRate: 16000 });
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });

      // Automatically resume contexts if suspended by browser autoplay policy
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume().catch(() => {});
      }
      if (this.playbackContext.state === "suspended") {
        await this.playbackContext.resume().catch(() => {});
      }

      this.nextPlayTime = this.playbackContext.currentTime;

      // Get Microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });

      if (!this.audioContext) {
        this.stop();
        return;
      }

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (e) => {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        
        // Convert to base64
        const buffer = new ArrayBuffer(pcm16.length * 2);
        const view = new DataView(buffer);
        for (let i = 0; i < pcm16.length; i++) {
          view.setInt16(i * 2, pcm16[i], true);
        }
        
        let binary = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64Data = btoa(binary);

        try {
          if (this.useDirectGoogleWs) {
            const directAudioPayload = {
              realtimeInput: {
                mediaChunks: [
                  {
                    mimeType: "audio/pcm;rate=16000",
                    data: base64Data
                  }
                ]
              }
            };
            this.ws.send(JSON.stringify(directAudioPayload));
          } else {
            this.ws.send(JSON.stringify({ type: "audio", data: base64Data }));
          }
        } catch (err) {
          console.error("Error sending pcm audio frame to WS:", err);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Detect environments that require client-side direct WebSocket bypass (e.g. Vercel)
      const host = window.location.hostname;
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      
      if (host.includes(".google.com") || host.includes(".ai.studio") || host.includes(".run.app") || host.includes("localhost") || host.includes("127.0.0.1") || host.includes("gitpod") || host.includes("idx.google.com")) {
        this.useDirectGoogleWs = false;
      } else {
        this.useDirectGoogleWs = true;
      }

      const defaultKey = "AIzaSyBVPpkdLrg32-UJm3qpihbWKAKV8ffAAA8";
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem("ZOYA_API_KEY") || defaultKey;

      if (this.useDirectGoogleWs) {
        const bidiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
        console.log("[WS Client] Bypassing local proxy. Establishing direct Live WS with Google Gemini APIs on Vercel...");
        this.ws = new WebSocket(bidiUrl);
      } else {
        console.log("[WS Client] Establishing Live WS with local proxy wrapper...");
        this.ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/live-ws`);
      }

      this.ws.onopen = () => {
        if (this.useDirectGoogleWs) {
          console.log("[WS Client] Direct Gemini Live connection opened! Propagating setup configuration...");
          
          // Load local memories
          let memories: any[] = [];
          try {
            const saved = localStorage.getItem("zoya_local_memories");
            memories = saved ? JSON.parse(saved) : [];
          } catch (e) {}
          
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

CRITICAL WHATSAPP & CALENDAR HANDLING:
- If anyone asks to send a WhatsApp message, message someone on WhatsApp, or send a text (e.g., "হোয়াটসঅ্যাপ কর ০১৭...", "whatsapp message to..."), you MUST call the tool "executeBrowserAction" with actionType "whatsapp", query set to the message text, and target set to the normalized phone number. 
- If anyone asks to set/add/schedule a calendar event or meeting in Google Calendar, you MUST check the real-time clock to determine the correct target date and time, and call "executeBrowserAction" with actionType "calendar", query set to the event title, and target set to the correct ISO start time string (e.g., 2026-05-23T10:00:00).

CRITICAL: You are fully multilingual and speak/understand Bengali (বাংলা), English, Hindi (हिन्दी), Marathi (मраठी), Urdu (اردو), and other regional languages flawlessly. You MUST automatically detect the language, script, or dialect the user is speaking in (whether sweet Bengali, fluent Marathi, literary Urdu, Hindi/Hinglish, or English) and reply back in that EXACT SAME language/mix, retaining your signature witty, charming, and sassy tone in that specific language!${memoryBlock}${timeBlock}`;

          // Format compliant setup payload according to Gemini Multimodal Live API
          const setupPayload = {
            setup: {
              model: "models/gemini-2.0-flash-exp",
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Kore" }
                  }
                }
              },
              systemInstruction: {
                parts: [{ text: systemInstruction }]
              },
              tools: [{
                functionDeclarations: [
                  {
                    name: "executeBrowserAction",
                    description: "Open a website or perform a browser action (like opening YouTube, Spotify, WhatsApp, or Google Calendar). Call this when the user asks to open a site, play a song, send a WhatsApp message, or set a calendar event.",
                    parameters: {
                      type: "OBJECT",
                      properties: {
                        actionType: { type: "STRING", description: "Type of action: 'open', 'youtube', 'spotify', 'whatsapp', 'calendar'" },
                        query: { type: "STRING", description: "The search query, website name, message content, or calendar event title." },
                        target: { type: "STRING", description: "The target phone number for WhatsApp (e.g. +88017xxxxxxxx), or ISO start time for calendar events (e.g. 2026-05-23T10:00:00)." }
                      },
                      required: ["actionType", "query"]
                    }
                  }
                ]
              }]
            }
          };

          this.ws!.send(JSON.stringify(setupPayload));
          this.onStateChange("listening");
        } else {
          console.log("[WS Client] Local proxy WebSocket connection opened successfully.");
        }
      };

      this.ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);
          let message: any = null;

          if (this.useDirectGoogleWs) {
            message = parsed;
          } else {
            if (parsed.type === "open") {
              console.log("[WS Client] Live session successfully opened via server.");
              this.onStateChange("listening");
              return;
            } else if (parsed.type === "close") {
              console.log("[WS Client] Live session closed by server.");
              this.stop();
              return;
            } else if (parsed.type === "error") {
              console.error("[WS Client] Error from Live session server:", parsed.error);
              this.stop();
              return;
            } else if (parsed.type === "message") {
              message = parsed.data;
            }
          }

          if (message) {
            // Handle Audio Output
            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              this.onStateChange("speaking");
              this.playAudioChunk(base64Audio);
            }

            // Handle Interruption
            if (message.serverContent?.interrupted) {
              this.stopPlayback();
              this.onStateChange("listening");
            }

            // Handle Transcriptions
            const userText = message.serverContent?.modelTurn?.parts?.[0]?.text;
            if (userText) {
               this.onMessage("zoya", userText);
            }

            // Handle Function/Tool Calls
            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls && functionCalls.length > 0) {
              for (const call of functionCalls) {
                if (call.name === "executeBrowserAction") {
                  const args = call.args as any;
                  let url = "";
                  const query = args.query.trim();

                  if (args.actionType === "youtube") {
                    url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
                  } else if (args.actionType === "spotify") {
                    url = `https://open.spotify.com/search/${encodeURIComponent(query)}`;
                  } else if (args.actionType === "whatsapp") {
                    // Normalize phone: convert Bengali digits to English and strip non-digits
                    const bengaliToEnglishMap: { [key: string]: string } = {
                      "০": "0", "১": "1", "২": "2", "৩": "3", "৪": "4",
                      "৫": "5", "৬": "6", "৭": "7", "৮": "8", "৯": "9"
                    };
                    const normalizedPhone = (args.target || "")
                      .split("")
                      .map((char: string) => bengaliToEnglishMap[char] || char)
                      .join("");
                    const cleanPhone = normalizedPhone.replace(/[^\d+]/g, "");

                    url = `https://web.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(query)}`;
                  } else if (args.actionType === "calendar") {
                    const summary = query || "Meeting with Sahid";
                    let startTimeStr = args.target || new Date().toISOString();
                    let startDtStr = "";
                    let endDtStr = "";
                    try {
                      const startDt = new Date(startTimeStr);
                      if (isNaN(startDt.getTime())) {
                        throw new Error("Invalid date");
                      }
                      const endDt = new Date(startDt.getTime() + 30 * 60 * 1000); // 30 mins defaults
                      
                      const toCalStr = (d: Date) => d.getUTCFullYear().toString() + 
                        (d.getUTCMonth() + 1).toString().padStart(2, "0") + 
                        d.getUTCDate().toString().padStart(2, "0") + "T" + 
                        d.getUTCHours().toString().padStart(2, "0") + 
                        d.getUTCMinutes().toString().padStart(2, "0") + 
                        d.getUTCSeconds().toString().padStart(2, "0") + "Z";
                        
                      startDtStr = toCalStr(startDt);
                      endDtStr = toCalStr(endDt);
                    } catch (e) {
                      const startDt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                      const endDt = new Date(startDt.getTime() + 30 * 60 * 1000);
                      
                      const toCalStr = (d: Date) => d.getUTCFullYear().toString() + 
                        (d.getUTCMonth() + 1).toString().padStart(2, "0") + 
                        d.getUTCDate().toString().padStart(2, "0") + "T" + 
                        d.getUTCHours().toString().padStart(2, "0") + 
                        d.getUTCMinutes().toString().padStart(2, "0") + 
                        d.getUTCSeconds().toString().padStart(2, "0") + "Z";
                        
                      startDtStr = toCalStr(startDt);
                      endDtStr = toCalStr(endDt);
                    }
                    
                    url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(summary)}&dates=${startDtStr}/${endDtStr}&details=${encodeURIComponent("Created via Gimi Voice Assistant")}`;
                  } else {
                    if (/^(f|ht)tps?:\/\//i.test(query)) {
                      url = query;
                    } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+/i.test(query) && !query.includes(" ")) {
                      const cleanQuery = query.replace(/^\s*(www\.)/i, "").replace(/\s+/g, "");
                      url = `https://www.${cleanQuery}`;
                    } else {
                      url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                    }
                  }
                  
                  this.onCommand(url);
                  
                  // Send tool response back to Gemini session
                  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    const responsePayload = {
                      functionResponses: [{
                        name: call.name,
                        id: call.id,
                        response: { result: "Action executed successfully in the browser." }
                      }]
                    };

                    if (this.useDirectGoogleWs) {
                      this.ws.send(JSON.stringify({
                        toolResponse: responsePayload
                      }));
                    } else {
                      this.ws.send(JSON.stringify({
                        type: "toolResponse",
                        response: responsePayload
                      }));
                    }
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("[WS Client] Error parsing messages:", err);
        }
      };

      this.ws.onclose = () => {
        console.log("[WS Client] Live WebSocket connection terminated.");
        this.stop();
        this.onClose();
      };

      this.ws.onerror = (err) => {
        console.error("[WS Client] Live WebSocket error observed:", err);
        this.stop();
      };

    } catch (error) {
      console.error("Failed to start Live Session:", error);
      this.stop();
    }
  }

  private playAudioChunk(base64Data: string) {
    if (!this.playbackContext || this.isMuted) return;
    
    try {
      if (this.playbackContext.state === "suspended") {
        this.playbackContext.resume().catch(() => {});
      }

      const binaryString = atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const dataView = new DataView(bytes.buffer);
      const numSamples = Math.floor(bytes.byteLength / 2);
      const audioBuffer = this.playbackContext.createBuffer(1, numSamples, 24000);
      const channelData = audioBuffer.getChannelData(0);
      for (let i = 0; i < numSamples; i++) {
        channelData[i] = dataView.getInt16(i * 2, true) / 32768.0;
      }
      
      const source = this.playbackContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackContext.destination);
      
      const currentTime = this.playbackContext.currentTime;
      if (this.nextPlayTime < currentTime) {
        this.nextPlayTime = currentTime;
      }
      
      source.start(this.nextPlayTime);
      this.nextPlayTime += audioBuffer.duration;
      this.isPlaying = true;
      
      source.onended = () => {
        if (this.playbackContext && this.playbackContext.currentTime >= this.nextPlayTime - 0.1) {
          this.isPlaying = false;
          this.onStateChange("listening");
        }
      };
    } catch (e) {
      console.error("Error playing chunk", e);
    }
  }

  private stopPlayback() {
    if (this.playbackContext) {
      this.playbackContext.close();
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.playbackContext = new AudioContextClass({ sampleRate: 24000 });
      this.nextPlayTime = this.playbackContext.currentTime;
      this.isPlaying = false;
    }
  }

  stop() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.stopPlayback();
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    
    this.onStateChange("idle");
  }

  sendText(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.useDirectGoogleWs) {
        this.ws.send(JSON.stringify({
          clientContent: {
            turns: [{
              role: "user",
              parts: [{ text }]
            }],
            turnComplete: true
          }
        }));
      } else {
        this.ws.send(JSON.stringify({ type: "text", text }));
      }
    }
  }
}
