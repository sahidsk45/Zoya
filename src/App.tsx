import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Video, VideoOff, PhoneOff
} from "lucide-react";
import { getZoyaResponse, getZoyaAudio, resetZoyaSession, getSavedMessages, clearSavedMessages } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import Visualizer from "./components/Visualizer";
import PermissionModal from "./components/PermissionModal";
import { playPCM } from "./utils/audioUtils";
import { motion, AnimatePresence } from "motion/react";

type AppState = "idle" | "listening" | "processing" | "speaking";

interface ChatMessage {
  id: string;
  sender: "user" | "zoya";
  text: string;
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

import zoyaAvatar from "./assets/images/zoya_avatar_1779288639777.png";

export default function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef(messages);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  useEffect(() => {
    cameraStreamRef.current = cameraStream;
  }, [cameraStream]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    async function loadHistory() {
      try {
        const saved = await getSavedMessages();
        if (saved && saved.length > 0) {
          setMessages(saved);
        } else {
          // Sync existing localStorage if any to database
          const local = localStorage.getItem("zoya_chat_history");
          if (local) {
            try {
              const parsed = JSON.parse(local);
              for (const msg of parsed) {
                await fetch("/api/messages", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ sender: msg.sender, text: msg.text }),
                });
              }
              setMessages(parsed);
            } catch (e) {
              console.error("Failed to parse localStorage chat history", e);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load chat history from database:", err);
      }
    }
    loadHistory();
  }, []);

  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const isSessionActiveRef = useRef(false);

  useEffect(() => {
    isSessionActiveRef.current = isSessionActive;
  }, [isSessionActive]);

  const liveSessionRef = useRef<LiveSessionManager | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, appState]);

  const handleTextCommand = useCallback(async (finalTranscript: string) => {
    if (!finalTranscript.trim()) {
      setAppState("idle");
      return;
    }

    setMessages((prev) => [...prev, { id: Date.now().toString(), sender: "user", text: finalTranscript }]);
    
    // If live session is active, send text through it
    if (isSessionActive && liveSessionRef.current) {
      liveSessionRef.current.sendText(finalTranscript);
      return;
    }

    setAppState("processing");

    // 1. Check for browser commands
    const commandResult = processCommand(finalTranscript);

    let responseText = "";

    if (commandResult.isBrowserAction) {
      responseText = commandResult.action;
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: responseText }]);
      
      // Save interactions to database so she remembers it!
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "user", text: finalTranscript }),
      }).catch(console.error);

      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "zoya", text: responseText }),
      }).catch(console.error);

      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }

      setAppState("idle");

      setTimeout(() => {
        if (commandResult.url) {
          window.open(commandResult.url, "_blank");
        }
      }, 1500);
    } else {
      // 2. General Chit-Chat via Gemini (which automatically saves and extracts on backend)
      responseText = await getZoyaResponse(finalTranscript);
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-z", sender: "zoya", text: responseText }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio(responseText);
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
      setAppState("idle");
    }
  }, [isMuted, isSessionActive]);

  const handleVideoRef = useCallback((node: HTMLVideoElement | null) => {
    if (node) {
      videoRef.current = node;
      if (cameraStream) {
        node.srcObject = cameraStream;
        node.play().catch((err) => {
          console.warn("Unable to play video element:", err);
        });
      }
    } else {
      videoRef.current = null;
    }
  }, [cameraStream]);

  const toggleWebcam = async () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      setCameraStream(null);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 480, height: 360, facingMode: "user" },
          audio: false
        });
        setCameraStream(stream);
      } catch (camError: any) {
        console.warn("User camera input access rejected or unavailable:", camError);
        alert("ক্যামেরা চালু করা যায়নি। অনুগ্রহ করে ব্রাউজার থেকে ক্যামেরা পারমিশন মঞ্জুর করুন।\n(Webcam request failed. Please check browser camera permissions!)");
      }
    }
  };

  useEffect(() => {
    let interval: any;
    if (isSessionActive) {
      setCallDuration(0);
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isSessionActive]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.stop();
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const toggleListening = async () => {
    if (isSessionActive) {
      isSessionActiveRef.current = false;
      setIsSessionActive(false);
      setAppState("idle");
      
      try {
        if (liveSessionRef.current) {
          liveSessionRef.current.stop();
        }
      } catch (e) {
        console.error("Error stopping liveSessionRef:", e);
      }
      liveSessionRef.current = null;

      try {
        if (cameraStream) {
          cameraStream.getTracks().forEach((track) => track.stop());
        }
      } catch (e) {
        console.error("Error stopping cameraStream components:", e);
      }
      setCameraStream(null);

      try {
        if (cameraStreamRef.current) {
          cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        }
      } catch (e) {
        console.error("Error stopping cameraStreamRef tracks:", e);
      }
      cameraStreamRef.current = null;

      resetZoyaSession();
    } else {
      try {
        setIsSessionActive(true);
        resetZoyaSession();
        
        // Dynamically start user camera preview
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 320, height: 240, facingMode: "user" },
            audio: false
          });
          setCameraStream(stream);
        } catch (camError) {
          console.warn("User camera input access rejected or unavailable:", camError);
        }
        
        const session = new LiveSessionManager();
        session.isMuted = isMuted;
        liveSessionRef.current = session;
        
        session.onStateChange = (state) => {
          setAppState(state);
        };
        
        session.onMessage = async (sender, text) => {
          setMessages((prev) => [...prev, { id: Date.now().toString() + "-" + sender, sender, text }]);

          // Save live message to SQLite database
          await fetch("/api/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sender, text }),
          }).catch(console.error);

          // Extract memory after turn
          if (sender === "zoya" && messagesRef.current.length >= 2) {
            const lastUserMsg = messagesRef.current[messagesRef.current.length - 2]?.text || "";
            await fetch("/api/memories/extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userMessage: lastUserMsg, assistantReply: text }),
            }).catch(console.error);
          }
        };
        
        session.onCommand = (url) => {
          setTimeout(() => {
            window.open(url, "_blank");
          }, 1000);
        };

        session.onClose = () => {
          if (isSessionActiveRef.current) {
            console.log("[App] Live session disconnected but UI is active. Reconnecting to bypass 10-minute limit...");
            setAppState("processing");
            setTimeout(async () => {
              if (isSessionActiveRef.current && liveSessionRef.current === session) {
                try {
                  const newSession = new LiveSessionManager();
                  newSession.isMuted = isMutedRef.current;
                  liveSessionRef.current = newSession;
                  
                  newSession.onStateChange = (state) => {
                    setAppState(state);
                  };
                  newSession.onMessage = session.onMessage;
                  newSession.onCommand = session.onCommand;
                  newSession.onClose = session.onClose;
                  
                  await newSession.start();
                  console.log("[App] Session reconnected successfully!");
                } catch (err) {
                  console.error("[App] Session reconnection failed:", err);
                  setAppState("idle");
                  setIsSessionActive(false);
                }
              }
            }, 1000);
          }
        };

        await session.start();
      } catch (e) {
        console.error("Failed to start session", e);
        setShowPermissionModal(true);
        setIsSessionActive(false);
        setAppState("idle");
      }
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    
    handleTextCommand(textInput);
    setTextInput("");
    setShowTextInput(false);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#050505] text-white flex flex-col items-center justify-between font-sans relative overflow-hidden m-0 p-0">
      {showPermissionModal && (
        <PermissionModal 
          onClose={() => setShowPermissionModal(false)} 
        />
      )}

      {/* Cinematic Background Gradients */}
      <div className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-violet-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-pink-900/20 blur-[120px] rounded-full" />
      </div>

      {/* Header */}
      <header className="absolute top-0 left-0 w-full flex justify-end items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      {isSessionActive ? (
        /* ==================== ACTIVE IMMERSIVE VIDEO CALL INTERFACE ==================== */
        <main className="absolute inset-0 w-full h-full z-10 overflow-hidden flex flex-col pointer-events-auto">
          <div className="relative w-full h-full bg-black overflow-hidden flex flex-col pointer-events-auto">
            
            {/* Full-screen background layout is now fully driven by the interactive Canvas Visualizer component below */}
            <Visualizer state={appState} avatarType="second" hideInterface={true} />

            {/* Ambient glassmorphic gradients overlaying the video backdrop */}
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black via-black/40 to-transparent z-1 pointer-events-none" />
            <div className="absolute inset-x-0 top-0 h-1/3 bg-gradient-to-b from-black/80 to-transparent z-1 pointer-events-none" />

            {/* Top Bar Call Coordinates Overlay */}
            <div className="absolute top-6 left-6 right-6 flex items-center justify-between z-20 pointer-events-none">
              <div className="flex items-center gap-2 bg-black/60 px-3.5 py-2 rounded-full backdrop-blur-md border border-white/10">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                <span className="text-[10px] font-mono tracking-widest text-red-400 font-bold">🔴 LIVE SESSION</span>
              </div>
              <div className="flex items-center gap-1.5 bg-black/60 px-3.5 py-2 rounded-full backdrop-blur-md border border-white/10 text-[10px] font-mono tracking-wider text-violet-300">
                <span>সময়:</span>
                <span className="font-bold text-white font-mono">{formatDuration(callDuration)}</span>
              </div>
            </div>

            {/* Overlay Status & Dynamic Voice Wave Display (Centered bottom-half matching Siri/Google Assistant) */}
            <div className="absolute inset-0 flex flex-col items-center justify-between pointer-events-none z-10 pt-24 pb-36">
              
              {/* Title Overlay in Top third */}
              <div className="text-center pointer-events-none select-none flex flex-col items-center mt-6">
                <span className="text-2xl md:text-3xl font-serif font-extrabold text-white tracking-[0.25em] block drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">GIMI AI</span>
                <div className="w-16 h-0.5 bg-gradient-to-r from-cyan-400 via-pink-500 to-violet-500 mt-2 rounded-full shadow-lg" />
              </div>

              {/* Dynamic glass voice spectrum container in Center third */}
              <div className="flex flex-col items-center justify-center pointer-events-none w-full max-w-lg px-6">
                <AnimatePresence mode="wait">
                  {appState === "speaking" ? (
                    <motion.div 
                      key="speaking-wave"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center gap-1.5 h-12 px-6 py-2 bg-black/55 rounded-full border border-pink-500/20 backdrop-blur-md shadow-[0_4px_25px_rgba(236,72,153,0.15)] pointer-events-none"
                    >
                      <motion.div animate={{ height: [6, 28, 8, 32, 6] }} transition={{ repeat: Infinity, duration: 0.3 }} className="w-1 rounded-full bg-cyan-400" />
                      <motion.div animate={{ height: [10, 38, 12, 34, 10] }} transition={{ repeat: Infinity, duration: 0.35 }} className="w-1 rounded-full bg-violet-400" />
                      <motion.div animate={{ height: [14, 46, 10, 42, 14] }} transition={{ repeat: Infinity, duration: 0.28 }} className="w-1 rounded-full bg-pink-500" />
                      <motion.div animate={{ height: [10, 38, 12, 34, 10] }} transition={{ repeat: Infinity, duration: 0.35 }} className="w-1 rounded-full bg-violet-400" />
                      <motion.div animate={{ height: [6, 28, 8, 32, 6] }} transition={{ repeat: Infinity, duration: 0.3 }} className="w-1 rounded-full bg-cyan-400" />
                    </motion.div>
                  ) : appState === "listening" ? (
                    <motion.div 
                      key="listening-glow"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center gap-2 px-5 py-2 bg-cyan-500/10 border border-cyan-400/30 rounded-full backdrop-blur-md shadow-[0_0_20px_rgba(6,182,212,0.15)]"
                    >
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      <span className="text-[10px] md:text-sm tracking-widest uppercase font-bold text-cyan-200">Listening to Sahid...</span>
                    </motion.div>
                  ) : appState === "processing" ? (
                    <motion.div 
                      key="processing-shimmer"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center gap-2.5 px-5 py-2 bg-pink-500/10 border border-pink-400/30 rounded-full backdrop-blur-md shadow-[0_0_20px_rgba(236,72,153,0.15)]"
                    >
                      <Loader2 size={13} className="text-pink-400 animate-spin" />
                      <span className="text-[10px] md:text-sm tracking-widest uppercase font-bold text-pink-200">Thinking...</span>
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="idle-state"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                      className="flex items-center gap-2 px-5 py-2 bg-white/5 border border-white/10 rounded-full backdrop-blur-sm"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                      <span className="text-[10px] tracking-widest uppercase font-bold text-zinc-400">SESSION IDLE</span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>


            </div>

            {/* Glassmorphic Centered Controller Bar holding adjacent capsules in standard format with generous spacing */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-10 py-6 rounded-[32px] bg-black/95 backdrop-blur-3xl border border-white/20 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12 z-25 pointer-events-auto shadow-[0_25px_70px_rgba(0,0,0,0.98)] max-w-[95%] w-auto select-none">
              
              {/* Capsule Pair 1: Media Inputs (Generous Gap for Sahid) */}
              <div className="flex items-center gap-5 sm:gap-7 bg-white/5 p-2 rounded-2xl border border-white/10">
                <button
                  onClick={toggleWebcam}
                  className={`flex items-center gap-3 px-6 py-4 rounded-xl text-[11px] sm:text-xs font-extrabold tracking-wider uppercase transition-all duration-200 hover:scale-[1.05] active:scale-[0.95] cursor-pointer ${
                    cameraStream
                      ? "bg-cyan-500/25 text-[#00E5FF] border border-[#00E5FF]/40"
                      : "bg-[#141417]/95 text-white/80 border border-white/10 hover:bg-white/10"
                  }`}
                  title={cameraStream ? "Turn off camera" : "Turn on camera"}
                >
                  {cameraStream ? <Video size={16} className="text-cyan-400 animate-pulse" /> : <VideoOff size={16} />}
                  <span>{cameraStream ? "VIDEO ON" : "VIDEO OFF"}</span>
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`flex items-center gap-3 px-6 py-4 rounded-xl text-[11px] sm:text-xs font-extrabold tracking-wider uppercase transition-all duration-200 hover:scale-[1.05] active:scale-[0.95] cursor-pointer ${
                    isMuted
                      ? "bg-red-500/25 text-red-400 border border-red-500/40"
                      : "bg-[#141417]/95 text-white/80 border border-white/10 hover:bg-white/10"
                  }`}
                  title={isMuted ? "Unmute microphone" : "Mute microphone"}
                >
                  {isMuted ? <MicOff size={16} className="text-red-400" /> : <Mic size={16} className="text-violet-400" />}
                  <span>{isMuted ? "MUTED" : "MUTE"}</span>
                </button>
              </div>

              {/* Capsule Pair 2: End Call action */}
              <button
                onClick={toggleListening}
                className="flex items-center gap-3 px-8 py-4.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold border border-red-500/50 text-[11px] sm:text-xs tracking-wider uppercase transition-all duration-200 hover:scale-[1.07] active:scale-[0.93] shadow-[0_8px_25px_rgba(239,68,68,0.5)] cursor-pointer"
              >
                <PhoneOff size={16} className="animate-pulse" />
                <span>END CALL</span>
              </button>

            </div>
          </div>

          {/* Floating Local Cam Picture-in-Picture Frame for Sahid (positioned safely above action triggers) */}
          <div 
            onClick={toggleWebcam}
            className="absolute bottom-32 sm:bottom-28 right-6 z-35 pointer-events-auto cursor-pointer"
            title="Click self-view to toggle camera"
          >
            <div className="relative w-28 h-36 sm:w-32 sm:h-40 rounded-2xl overflow-hidden border border-[#00E5FF]/20 bg-[#0c0c0e]/95 shadow-[0_0_30px_rgba(6,182,212,0.15)] flex flex-col justify-end transition-all duration-300 hover:scale-[1.03]">
              {cameraStream ? (
                <>
                  <video
                    ref={handleVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="absolute inset-0 w-full h-full object-cover scale-x-[-1]"
                  />
                  <div className="absolute inset-0 opacity-0 hover:opacity-100 bg-black/60 flex flex-col items-center justify-center text-[10px] font-mono tracking-widest text-[#00E5FF] font-bold transition-opacity p-2 text-center select-none">
                    <span>🛑</span>
                    <span className="mt-1 font-mono text-[8px] tracking-wide">TAP TO CLOSE</span>
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center bg-[#070709] border border-white/5 hover:bg-cyan-950/20 transition-all duration-250">
                  <span className="text-xl animate-pulse">👤</span>
                  <span className="text-[8px] mt-1.5 text-cyan-400 font-mono tracking-widest font-bold">CAM OFF</span>
                  <span className="text-[7px] text-gray-400 font-mono tracking-wide mt-1 underline">TAP TO START</span>
                </div>
              )}
              
              {/* Label indicating the boss - Sahid */}
              <div className="absolute bottom-1.5 left-1.5 right-1.5 bg-black/80 backdrop-blur-sm rounded-lg py-1 text-[8px] font-mono font-bold tracking-widest text-[#00E5FF] border border-[#00E5FF]/20 text-center uppercase">
                BOSS: SAHID
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* ==================== IDLE STARTUP INTERFACE ==================== */
        <main className="absolute inset-0 flex flex-row items-center justify-between w-full h-full z-10 overflow-hidden pt-20 pb-24 px-4 md:px-12 pointer-events-none">
          
          {/* Left Column: Gimi Status */}
          <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
            <div className="h-6">
              <AnimatePresence>
                {appState === "processing" && (
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex items-center gap-2 text-cyan-300/80 text-sm md:text-base italic font-serif"
                  >
                    <Loader2 size={16} className="animate-spin" />
                    Replying...
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Center Visualizer (Fixed Full Screen Background) - Handled interactively with z-15 */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-15">
            <Visualizer state={appState} onToggle={toggleListening} avatarType="first" />
          </div>

          {/* Right Column: User Status */}
          <div className="flex w-[30%] lg:w-[25%] h-full flex-col justify-center gap-4 z-10">
            <div className="h-6 flex justify-end">
              <AnimatePresence>
                {appState === "listening" && (
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex items-center gap-2 text-violet-300/80 text-sm md:text-base italic"
                  >
                    <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                    Listening...
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

        </main>
      )}

      {/* Controls */}
      {!isSessionActive && (
        <footer className="absolute bottom-0 left-0 w-full flex flex-col items-center justify-center pb-6 md:pb-8 z-20 shrink-0 gap-4">
          <AnimatePresence>
            {showTextInput && (
              <motion.form 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                onSubmit={handleTextSubmit}
                className="w-full max-w-md flex items-center gap-2 bg-white/5 border border-white/10 rounded-full p-1 pl-4 backdrop-blur-md shadow-2xl"
              >
                <input 
                  type="text"
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="Type a message to Gimi..."
                  className="flex-1 bg-transparent border-none outline-none text-white placeholder:text-white/30 text-sm"
                  autoFocus
                />
                <button 
                  type="submit"
                  disabled={!textInput.trim()}
                  className="p-2 rounded-full bg-violet-500 hover:bg-violet-600 disabled:opacity-50 disabled:hover:bg-violet-500 transition-colors"
                >
                  <Send size={16} />
                </button>
              </motion.form>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-4">
            {/* Custom Action Controls Row in the footer: Keyboard, Mute/Voice, and Discard/Trash options together */}
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 p-2 rounded-full backdrop-blur-md shadow-2xl z-20 pointer-events-auto">
              {!isSessionActive && (
                <button
                  onClick={() => setShowTextInput(!showTextInput)}
                  className={`p-3 rounded-full transition-all duration-200 cursor-pointer ${showTextInput ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'hover:bg-white/10 text-white/70 hover:text-white'}`}
                  title="Type message to Gimi"
                >
                  <Keyboard size={20} />
                </button>
              )}

              <button
                onClick={() => setIsMuted(!isMuted)}
                className={`p-3 rounded-full transition-all duration-200 cursor-pointer hover:scale-105 border ${
                  isMuted 
                    ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/35' 
                    : 'bg-white/5 text-green-400 border-white/10 hover:bg-white/10'
                }`}
                title={isMuted ? "Unmute Gimi Voice" : "Mute Gimi Voice"}
              >
                {isMuted ? (
                  <VolumeX size={20} className="text-red-400" />
                ) : (
                  <Volume2 size={20} className="text-green-400 animate-pulse" />
                )}
              </button>

              {messages.length > 0 && (
                <button
                  onClick={async () => {
                    if (confirm("Are you sure you want to clear the chat history?")) {
                      await clearSavedMessages();
                      setMessages([]);
                      resetZoyaSession();
                    }
                  }}
                  className="p-3 rounded-full hover:bg-red-500/10 text-white/50 hover:text-red-400 border border-transparent hover:border-red-500/20 transition-all duration-200 cursor-pointer hover:scale-105"
                  title="Clear Conversational History (Kete dewa)"
                >
                  <Trash2 size={20} />
                </button>
              )}
            </div>
          </div>
        </footer>
      )}


    </div>
  );
}
