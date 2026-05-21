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
  
  public onStateChange: (state: "idle" | "listening" | "processing" | "speaking") => void = () => {};
  public onMessage: (sender: "user" | "zoya", text: string) => void = () => {};
  public onCommand: (url: string) => void = () => {};

  constructor() {
    // No direct client-side GoogleGenAI initialization
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
        // Session stopped/aborted while waiting for user microphone permission
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
          this.ws.send(JSON.stringify({ type: "audio", data: base64Data }));
        } catch (err) {
          console.error("Error sending pcm audio frame to WS:", err);
        }
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Connect to server proxy WS
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      this.ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/live-ws`);

      this.ws.onopen = () => {
        console.log("[WS Client] Local proxy WebSocket connection opened.");
      };

      this.ws.onmessage = async (event) => {
        try {
          const parsed = JSON.parse(event.data);
          
          if (parsed.type === "open") {
            console.log("[WS Client] Live session successfully opened via server.");
            this.onStateChange("listening");
          } else if (parsed.type === "close") {
            console.log("[WS Client] Live session closed by server.");
            this.stop();
          } else if (parsed.type === "error") {
            console.error("[WS Client] Error from Live session server:", parsed.error);
            this.stop();
          } else if (parsed.type === "message") {
            const message = parsed.data;

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
                    url = `https://web.whatsapp.com/send?phone=${args.target || ""}&text=${encodeURIComponent(query)}`;
                  } else {
                    // Check if it's already an absolute HTTP/HTTPS URL
                    if (/^(f|ht)tps?:\/\//i.test(query)) {
                      url = query;
                    } else if (/^[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+/i.test(query) && !query.includes(" ")) {
                      // It looks like a clear domain (like google.com, facebook.com, sahidsheikh.in)
                      // Strip any leading www. so we can add it cleanly if needed
                      const cleanQuery = query.replace(/^\s*(www\.)/i, "").replace(/\s+/g, "");
                      url = `https://www.${cleanQuery}`;
                    } else {
                      // It's a general topic query, fall back to Google Search
                      url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                    }
                  }
                  
                  this.onCommand(url);
                  
                  // Send tool response back to Gemini session through proxy
                  if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                     this.ws.send(JSON.stringify({
                       type: "toolResponse",
                       response: {
                         functionResponses: [{
                           name: call.name,
                           id: call.id,
                           response: { result: "Action executed successfully in the browser." }
                         }]
                       }
                     }));
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
        console.log("[WS Client] Local proxy WebSocket closed.");
        this.stop();
      };

      this.ws.onerror = (err) => {
        console.error("[WS Client] Local proxy WebSocket connection error:", err);
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
      // Auto-resume playback context if suspended during active session
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
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }
}
