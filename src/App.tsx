import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Mic, MicOff, Loader2, Volume2, VolumeX, Keyboard, Send, Trash2, Video, VideoOff, PhoneOff,
  Calendar, Clock, Plus, Trash, UserCheck, BookOpen, Brain, Sparkles, CheckCircle2, RefreshCw, X, LogIn, LogOut
} from "lucide-react";
import { getZoyaResponse, getZoyaAudio, resetZoyaSession, getSavedMessages, clearSavedMessages } from "./services/geminiService";
import { processCommand } from "./services/commandService";
import { LiveSessionManager } from "./services/liveService";
import { 
  initAuth, googleSignIn, logout, listCalendarEvents, createCalendarEvent, deleteCalendarEvent, CalendarEvent 
} from "./services/googleCalendarService";
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

  // Google Auth & Calendar states
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [showAddEvent, setShowAddEvent] = useState(false);
  
  // Create Event Form inputs
  const [eventSummary, setEventSummary] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [eventDuration, setEventDuration] = useState(30);

  // Storyteller Hub state
  const [storyTopic, setStoryTopic] = useState("");
  const [storyGenre, setStoryGenre] = useState("রূপকথা"); // Default genre
  const [storyDuration, setStoryDuration] = useState(1); // Default 1 min
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [generatedStory, setGeneratedStory] = useState("");

  // SQLite memories state
  const [memories, setMemories] = useState<any[]>([]);

  // Active side widget tab
  const [activeTab, setActiveTab] = useState<"calendar" | "storyteller" | "memories" | null>(null);

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

  // Load Zoya memories from SQLite
  const loadMemories = async () => {
    try {
      const res = await fetch("/api/memories");
      if (res.ok) {
        const data = await res.json();
        setMemories(data);
      }
    } catch (e) {
      console.error("Failed to load memories:", e);
    }
  };

  useEffect(() => {
    loadMemories();
  }, [messages, appState]);

  // Google OAuth flow and calendar functions
  const loadCalendar = async () => {
    setLoadingCalendar(true);
    setCalendarError(null);
    try {
      const events = await listCalendarEvents();
      setCalendarEvents(events);
    } catch (err: any) {
      console.warn("Google Calendar failed to load:", err);
      setCalendarError(err.message || String(err));
    } finally {
      setLoadingCalendar(false);
    }
  };

  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setGoogleUser(user);
        loadCalendar();
      },
      () => {
        setGoogleUser(null);
        setCalendarEvents([]);
      }
    );
    return () => {
      if (unsubscribe && typeof unsubscribe === "function") unsubscribe();
    };
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setLoadingCalendar(true);
      const result = await googleSignIn();
      if (result) {
        setGoogleUser(result.user);
        setTimeout(() => loadCalendar(), 600);
      }
    } catch (err: any) {
      console.error("Google single-sign-on rejected:", err);
      alert(`গুগল লগইন ব্যর্থ হয়েছে: ${err.message || err}`);
    } finally {
      setLoadingCalendar(false);
    }
  };

  const handleGoogleLogout = async () => {
    if (confirm("আপনি কি গুগল সাইন-আউট করতে চান? (Sign out from Google?)")) {
      await logout();
      setGoogleUser(null);
      setCalendarEvents([]);
    }
  };

  const handleDeleteEvent = async (eventId: string, summary: string) => {
    const isConfirmed = window.confirm(`আপনি কি "${summary}" ক্যালেন্ডার ইভেন্টটি ডিলিট করতে চান? (Are you sure you want to delete this event?)`);
    if (!isConfirmed) return;

    try {
      setLoadingCalendar(true);
      await deleteCalendarEvent(eventId);
      await loadCalendar();
    } catch (err: any) {
      console.error("Failed delete calendar event:", err);
      alert(`ডিলিট করা যায়নি: ${err.message || err}`);
    } finally {
      setLoadingCalendar(false);
    }
  };

  const handleAddEventSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventSummary || !eventDate || !eventTime) {
      alert("অনুগ্রহ করে সব তথ্য দিন! (Please provide all details)");
      return;
    }

    const isConfirmed = window.confirm(`আপনি কি গুগল ক্যালেন্ডারে "${eventSummary}" ইভেন্টটি যুক্ত করতে চান? (Are you sure you want to add this event?)`);
    if (!isConfirmed) return;

    try {
      setLoadingCalendar(true);
      const isoDateTime = `${eventDate}T${eventTime}:00`;
      await createCalendarEvent(eventSummary, isoDateTime, eventDuration);
      setEventSummary("");
      setEventDate("");
      setEventTime("");
      setShowAddEvent(false);
      await loadCalendar();
    } catch (err: any) {
      console.error("Google Calendar Create failed:", err);
      alert(`ইভেন্ট যুক্ত করা যায়নি: ${err.message || err}`);
    } finally {
      setLoadingCalendar(false);
    }
  };

  // Dedicated story generator satisfying 'long story tell' and 'minute duration select' requirements
  const handleGenerateStory = async () => {
    if (isGeneratingStory) return;
    
    setIsGeneratingStory(true);
    setGeneratedStory("");
    setAppState("processing");
    
    const topicText = storyTopic ? `"${storyTopic}" বিষয়ের উপর` : "একটি চমৎকার এবং মজাদার";
    const prompt = `তোমার নাম জোয়া (Zoya)। তোমার সিগনেচার স্টাইল এবং কৌতুকপূর্ণ মেজাজে আমাকে একটি সুন্দর ${storyGenre} গল্প শোনাও। গল্পটি যেন সম্পূর্ণ ${storyDuration} মিনিট ধরে পড়া যায় এমন বড় গল্প হয়। ${topicText} গল্পটি সম্পূর্ণ বাংলায় লেখো এবং এতে চমৎকার নাটকীয়তা রাখো। আমাদের বসের নাম সাঈদ শেখ (Sahid Sheikh) সুন্দর করে গল্পের মাঝে উল্লেখ করো!`;

    try {
      const response = await getZoyaResponse(prompt);
      setGeneratedStory(response);
      setMessages((prev) => [...prev, { id: Date.now().toString() + "-story", sender: "zoya", text: response }]);
      
      if (!isMuted) {
        setAppState("speaking");
        const audioBase64 = await getZoyaAudio("অবশ্যই ভাইয়া, তোমার জন্য চমৎকার একটা গল্প শোনাচ্ছি! মন দিয়ে শোনো...");
        if (audioBase64) {
          await playPCM(audioBase64);
        }
      }
    } catch (e) {
      console.error("Failed to generate Zoya story:", e);
      setGeneratedStory("গল্প বলার সময় একটু গণ্ডগোল হয়ে গেল ভাইয়া! পরে চেষ্টা করো।");
    } finally {
      setIsGeneratingStory(false);
      setAppState("idle");
    }
  };

  const handleClearMemories = async () => {
    if (confirm("আপনি কি বসের নামের সব স্মৃতি মুছে ফেলতে চান? (Are you sure you want to clear Zoya's memories?)")) {
      try {
        const res = await fetch("/api/memories/clear", { method: "POST" });
        if (res.ok) {
          setMemories([]);
          alert("সব স্মৃতি মুছে ফেলা হয়েছে! (Memories cleared!)");
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.isMuted = isMuted;
    }
  }, [isMuted]);

  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [showPermissionModal, setShowPermissionModal] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);

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

  useEffect(() => {
    if (videoRef.current) {
      if (cameraStream) {
        videoRef.current.srcObject = cameraStream;
        videoRef.current.play().catch((err) => {
          console.warn("Unable to play video element:", err);
        });
      } else {
        videoRef.current.srcObject = null;
      }
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
      <header className="absolute top-0 left-0 w-full flex justify-between items-center z-20 shrink-0 px-6 py-4 md:px-12 md:py-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center font-bold text-sm">
            Z
          </div>
          <h1 className="text-xl font-serif font-medium tracking-wide opacity-90">Zoya</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTab(activeTab ? null : "calendar")}
            className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 border border-violet-500/30 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer pointer-events-auto hover:scale-105 active:scale-95"
            title="Open Zoya Multi-tasking Dashboard"
          >
            <Sparkles size={14} className="text-pink-400" />
            <span>DASHBOARD</span>
          </button>
          
          {/* Subtle live indicator status */}
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono tracking-widest text-[#00E5FF]/80">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00E5FF] animate-ping" />
            LIVE VOICE SESSION
          </div>
        </div>
      </header>

      {/* Main Content - Visualizer & Chat */}
      {isSessionActive ? (
        /* ==================== ACTIVE IMMERSIVE VIDEO CALL INTERFACE ==================== */
        <main className="absolute inset-0 w-full h-full z-10 overflow-hidden flex flex-col pointer-events-auto">
          <div className="relative w-full h-full bg-black overflow-hidden flex flex-col pointer-events-auto">
            
            {/* Immersive Full-Screen Zoya Photo / Background - Animate the photo to speak and breathe */}
            <motion.div 
              animate={
                appState === "speaking"
                  ? {
                      scale: [1, 1.05, 1.01, 1.06, 1],
                      x: [0, -2.5, 2.5, -1.5, 0],
                      y: [0, -3.5, 3.5, -2, 0],
                      skewX: [0, -0.5, 0.5, 0],
                      filter: ["saturate(0.95) contrast(1)", "saturate(1.08) contrast(1.03)", "saturate(0.95) contrast(1)"],
                    }
                  : appState === "listening"
                  ? {
                      scale: [1, 1.015, 1],
                      y: [0, -2, 0],
                    }
                  : appState === "processing"
                  ? {
                      scale: [1, 1.025, 1],
                      filter: ["saturate(0.95) brightness(0.95)", "saturate(0.85) brightness(0.85)", "saturate(0.95) brightness(0.95)"],
                      skewY: [0, 0.2, -0.2, 0],
                    }
                  : {
                      scale: [1, 1.01, 1],
                    }
              }
              transition={
                appState === "speaking"
                  ? { repeat: Infinity, duration: 1.1, ease: "easeInOut" }
                  : appState === "listening"
                  ? { repeat: Infinity, duration: 2.0, ease: "easeInOut" }
                  : appState === "processing"
                  ? { repeat: Infinity, duration: 1.2, ease: "linear" }
                  : { repeat: Infinity, duration: 4.5, ease: "easeInOut" }
              }
              className="absolute inset-0 w-full h-full select-none overflow-hidden bg-black z-0 origin-center"
            >
              <img
                src={zoyaAvatar}
                alt="Zoya Immersive Full Screen"
                className="w-full h-full object-cover opacity-80 filter saturate-[0.98] select-none transition-all duration-300"
                referrerPolicy="no-referrer"
              />
            </motion.div>

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
                <span className="text-2xl md:text-3xl font-serif font-extrabold text-white tracking-[0.25em] block drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)]">ZOYA AI</span>
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

            {/* Glassmorphic Centered Controller Bar holding adjacent capsules in standard format */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-8 py-5 rounded-[28px] bg-black/90 backdrop-blur-3xl border border-white/15 flex flex-col sm:flex-row items-center justify-center gap-6 sm:gap-8 z-25 pointer-events-auto shadow-[0_20px_60px_rgba(0,0,0,0.95)] max-w-[95%] w-auto select-none">
              
              {/* Capsule Pair 1: Media Inputs (NO BENGALI, STRICTLY CLEAN ENGLISH) */}
              <div className="flex items-center gap-3 sm:gap-4 bg-white/5 p-1.5 rounded-2xl border border-white/10">
                <button
                  onClick={toggleWebcam}
                  className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer ${
                    cameraStream
                      ? "bg-cyan-500/25 text-[#00E5FF] border border-[#00E5FF]/30 font-extrabold"
                      : "bg-[#141417]/90 text-white/80 border border-white/5 hover:bg-white/10"
                  }`}
                  title={cameraStream ? "Turn off camera" : "Turn on camera"}
                >
                  {cameraStream ? <Video size={14} className="text-cyan-400 animate-pulse" /> : <VideoOff size={14} />}
                  <span>{cameraStream ? "VIDEO ON" : "VIDEO OFF"}</span>
                </button>

                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer ${
                    isMuted
                      ? "bg-red-500/25 text-red-400 border border-red-500/30 font-extrabold"
                      : "bg-[#141417]/90 text-white/80 border border-white/5 hover:bg-white/10"
                  }`}
                  title={isMuted ? "Unmute microphone" : "Mute microphone"}
                >
                  {isMuted ? <MicOff size={14} className="text-red-400" /> : <Mic size={14} className="text-violet-400" />}
                  <span>{isMuted ? "MUTED" : "MUTE"}</span>
                </button>
              </div>

              {/* Capsule Pair 2: Interactive Actions (NO BENGALI, STRICTLY CLEAN ENGLISH) */}
              <div className="flex items-center gap-3 sm:gap-4 bg-white/5 p-1.5 rounded-2xl border border-white/10">
                <button
                  onClick={() => setActiveTab(activeTab ? null : "calendar")}
                  className={`flex items-center gap-2.5 px-5 py-3 rounded-xl text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] cursor-pointer ${
                    activeTab
                      ? "bg-violet-500/30 text-violet-300 border border-violet-500/40 font-extrabold shadow-lg shadow-violet-500/10"
                      : "bg-[#141417]/90 text-white/80 border border-white/5 hover:bg-white/10"
                  }`}
                >
                  <Sparkles size={14} className="text-pink-400" />
                  <span>DASHBOARD</span>
                </button>

                <button
                  onClick={toggleListening}
                  className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-extrabold border border-red-500/40 text-[10px] sm:text-xs tracking-wider uppercase transition-all duration-200 hover:scale-[1.05] active:scale-[0.95] shadow-[0_6px_20px_rgba(239,68,68,0.45)] cursor-pointer"
                >
                  <PhoneOff size={14} className="animate-bounce" />
                  <span>END CALL</span>
                </button>
              </div>

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
                    ref={videoRef}
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
          
          {/* Left Column: Zoya Status */}
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
            <Visualizer state={appState} onToggle={toggleListening} />
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
                  placeholder="Type a message to Zoya..."
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
                  title="Type message to Zoya"
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
                title={isMuted ? "Unmute Zoya Voice" : "Mute Zoya Voice"}
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

      {/* Sliding Multitasking Hub Sidebar */}
      <AnimatePresence>
        {activeTab && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute top-0 right-0 h-full w-full sm:w-[420px] bg-black/85 border-l border-white/10 backdrop-blur-2xl z-40 flex flex-col pointer-events-auto shadow-2xl select-text"
          >
            {/* Header */}
            <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <Sparkles className="text-violet-400 animate-pulse" size={18} />
                <h2 className="text-sm font-serif font-bold tracking-wider text-white">জোয়া মাল্টি-টাস্ক হাব</h2>
              </div>
              <button
                onClick={() => setActiveTab(null)}
                className="p-1.5 rounded-full hover:bg-white/15 text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Dashboard Navigation Tabs */}
            <div className="grid grid-cols-3 border-b border-white/5 bg-white/5 p-1.5 text-xs text-center font-bold tracking-wider shrink-0">
              <button
                onClick={() => setActiveTab("calendar")}
                className={`py-2 rounded-lg transition-all ${
                  activeTab === "calendar" 
                    ? "bg-violet-600/30 text-violet-400 border border-violet-500/20" 
                    : "text-white/60 hover:text-white lg:hover:bg-white/5"
                }`}
              >
                📅 ক্যালেন্ডার
              </button>
              <button
                onClick={() => setActiveTab("storyteller")}
                className={`py-2 rounded-lg transition-all ${
                  activeTab === "storyteller" 
                    ? "bg-violet-600/30 text-violet-400 border border-violet-500/20" 
                    : "text-white/60 hover:text-white lg:hover:bg-white/5"
                }`}
              >
                🎭 গল্পঘর
              </button>
              <button
                onClick={() => setActiveTab("memories")}
                className={`py-2 rounded-lg transition-all ${
                  activeTab === "memories" 
                    ? "bg-violet-600/30 text-violet-400 border border-violet-500/20" 
                    : "text-white/60 hover:text-white lg:hover:bg-white/5"
                }`}
              >
                🧠 স্মৃতিভাণ্ডার
              </button>
            </div>

            {/* Content panel */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              
              {/* === CALENDAR TAB === */}
              {activeTab === "calendar" && (
                <div className="space-y-5">
                  {!googleUser ? (
                    <div className="flex flex-col items-center justify-center py-10 px-4 text-center space-y-5">
                      <div className="w-16 h-16 rounded-full bg-cyan-950/40 border border-cyan-500/20 flex items-center justify-center text-3xl">
                        📅
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold tracking-wider text-white">গুগল ক্যালেন্ডার বন্ধ</h3>
                        <p className="text-xs text-gray-400 font-serif leading-relaxed">
                          লগইন করে সরাসরি বসের ক্যালেন্ডারে টাইম সেট করুন বা সময় পরিবর্তন করুন!
                        </p>
                      </div>
                      <button
                        onClick={handleGoogleLogin}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold tracking-widest text-white bg-violet-600 hover:bg-violet-700 transition-all shadow-[0_4px_12px_rgba(139,92,246,0.3)] hover:scale-[1.02] cursor-pointer"
                      >
                        <LogIn size={15} />
                        SIGN IN WITH GOOGLE
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-5 flex flex-col">
                      {/* Active profile card */}
                      <div className="p-3 bg-white/5 rounded-2xl border border-white/5 flex items-center justify-between shrink-0">
                        <div className="flex items-center gap-2.5">
                          {googleUser.photoURL ? (
                            <img src={googleUser.photoURL} className="w-8 h-8 rounded-full border border-[#00E5FF]/20" alt="Google profile" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center font-bold text-xs uppercase text-white">
                              {googleUser.displayName?.charAt(0) || "U"}
                            </div>
                          )}
                          <div className="text-left">
                            <p className="text-xs font-bold text-white tracking-wide">{googleUser.displayName || "Google User"}</p>
                            <p className="text-[10px] text-gray-400 font-mono tracking-wide">{googleUser.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={handleGoogleLogout}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors cursor-pointer"
                          title="Sign Out Google Account"
                        >
                          <LogOut size={14} />
                        </button>
                      </div>

                      {/* Header for add event */}
                      <div className="flex items-center justify-between shrink-0 pt-2">
                        <h3 className="text-xs font-bold font-mono tracking-widest text-[#00E5FF] uppercase">Upcoming Events</h3>
                        <button
                          onClick={() => setShowAddEvent(!showAddEvent)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold tracking-wider uppercase transition-colors cursor-pointer ${
                            showAddEvent
                              ? "bg-white/10 text-white"
                              : "bg-[#00E5FF]/10 text-[#00E5FF] hover:bg-[#00E5FF]/20"
                          }`}
                        >
                          <Plus size={11} />
                          {showAddEvent ? "বন্ধ করুন" : "টাইম সেট করুন"}
                        </button>
                      </div>

                      {/* Quick Add Form */}
                      {showAddEvent && (
                        <motion.form
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          onSubmit={handleAddEventSubmit}
                          className="p-4 bg-white/5 border border-white/5 rounded-2xl space-y-4 text-left"
                        >
                          <p className="text-[10px] uppercase tracking-widest text-violet-400 font-bold">নতুন ইভেন্ট যোগ করুন</p>
                          <div className="space-y-3">
                            <div>
                              <label className="block text-[9px] uppercase tracking-wider text-gray-400 mb-1 font-bold">ইভেন্টের নাম (Summary)</label>
                              <input
                                type="text"
                                value={eventSummary}
                                onChange={(e) => setEventSummary(e.target.value)}
                                placeholder="যেমন: সাঈদের সাথে গুরুত্বপূর্ণ কাজ..."
                                className="w-full bg-[#121214] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                                required
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[9px] uppercase tracking-wider text-gray-400 mb-1 font-bold">তারিখ (Date)</label>
                                <input
                                  type="date"
                                  value={eventDate}
                                  onChange={(e) => setEventDate(e.target.value)}
                                  className="w-full bg-[#121214] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                                  required
                                />
                              </div>
                              <div>
                                <label className="block text-[9px] uppercase tracking-wider text-gray-400 mb-1 font-bold">সময় (Time)</label>
                                <input
                                  type="time"
                                  value={eventTime}
                                  onChange={(e) => setEventTime(e.target.value)}
                                  className="w-full bg-[#121214] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                                  required
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[9px] uppercase tracking-wider text-gray-400 mb-1 font-bold">স্থায়িত্ব (Duration)</label>
                              <select
                                value={eventDuration}
                                onChange={(e) => setEventDuration(Number(e.target.value))}
                                className="w-full bg-[#121214] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                              >
                                <option value={15}>১৫ মিনিট (15 Min)</option>
                                <option value={30}>৩০ মিনিট (30 Min)</option>
                                <option value={60}>১ ঘন্টা (1 Hour)</option>
                                <option value={120}>২ ঘন্টা (2 Hour)</option>
                              </select>
                            </div>
                          </div>
                          <button
                            type="submit"
                            className="w-full py-2 bg-gradient-to-r from-[#00E5FF] to-violet-500 text-black text-xs font-bold tracking-widest uppercase rounded-lg shadow-md hover:opacity-90 transition-opacity cursor-pointer"
                          >
                            সিডিউল সেভ করুন (Save Schedule)
                          </button>
                        </motion.form>
                      )}

                      {/* Loading items */}
                      {loadingCalendar ? (
                        <div className="flex flex-col items-center justify-center py-10 space-y-2">
                          <Loader2 className="animate-spin text-cyan-400" size={20} />
                          <p className="text-[10px] text-gray-400 font-mono tracking-widest uppercase">Syncing Calendar...</p>
                        </div>
                      ) : calendarError ? (
                        <div className="p-4 rounded-2xl bg-red-950/20 border border-red-500/20 text-center">
                          <span className="text-lg">⚠️</span>
                          <p className="text-[10px] font-mono tracking-wide text-red-300 mt-1">Calendar configuration is active or loading.</p>
                          <button
                            onClick={handleGoogleLogin}
                            className="mt-3 px-3 py-1.5 bg-red-950/40 text-red-400 hover:bg-red-950/60 border border-red-500/20 text-[9px] tracking-wider uppercase rounded-md transition-all font-bold cursor-pointer"
                          >
                            লগইন রিফ্রেশ করুন
                          </button>
                        </div>
                      ) : calendarEvents.length === 0 ? (
                        <div className="py-12 border border-dashed border-white/5 rounded-2xl flex flex-col items-center justify-center text-center px-4 mt-2">
                          <span className="text-2xl opacity-40 mb-1">🗓️</span>
                          <p className="text-xs text-gray-400 font-serif">কোনো ইভেন্ট খুঁজে পাওয়া যায়নি।</p>
                        </div>
                      ) : (
                        <div className="space-y-2.5 mt-2">
                          {calendarEvents.map((ev) => {
                            const dateStr = ev.start?.dateTime || ev.start?.date || "";
                            let formattedTime = "";
                            if (dateStr) {
                              const d = new Date(dateStr);
                              formattedTime = d.toLocaleString("bn-BD", {
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              });
                            }
                            return (
                              <div
                                key={ev.id}
                                className="group relative p-3.5 rounded-2xl bg-[#09090b] hover:bg-white/5 border border-white/5 transition-all flex items-start justify-between text-left"
                              >
                                <div className="space-y-1.5 select-all pr-4">
                                  <p className="text-xs font-bold text-white tracking-wide pr-3 leading-normal">{ev.summary}</p>
                                  <div className="flex items-center gap-1.5 text-[9px] text-gray-400 font-mono tracking-wide">
                                    <Clock size={11} className="text-[#00E5FF]/70" />
                                    <span>{formattedTime}</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDeleteEvent(ev.id, ev.summary)}
                                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                                  title="Delete Event"
                                >
                                  <Trash size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* === STORYTELLER TAB === */}
              {activeTab === "storyteller" && (
                <div className="space-y-5 text-left">
                  <div className="p-4 bg-white/5 border border-white/5 rounded-2xl flex items-center gap-3">
                    <BookOpen size={24} className="text-violet-400" />
                    <div>
                      <p className="text-xs font-bold text-white">জোয়ার গল্পঘর (Story Cabin)</p>
                      <p className="text-[10px] text-gray-400 font-serif leading-relaxed">
                        আমি মিনিটে সিলেক্ট করা দীর্ঘ বাংলা গল্প শোনাতে পারি! বসের পছন্দ মতো থিম সাজাও।
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 font-bold">গল্পের বিষয় (Optional Topic)</label>
                      <input
                        type="text"
                        value={storyTopic}
                        onChange={(e) => setStoryTopic(e.target.value)}
                        placeholder="যেমন: সাঈদের চাঁদে ঘুরে আসা, শিয়ালের বুদ্ধিমত্তা..."
                        className="w-full bg-[#121214] border border-white/10 rounded-xl p-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 font-bold">গল্পের ধরন (Genre)</label>
                        <select
                          value={storyGenre}
                          onChange={(e) => setStoryGenre(e.target.value)}
                          className="w-full bg-[#121214] border border-white/10 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                        >
                          <option value="রূপকথা">🧚‍♀️ রূপকথা</option>
                          <option value="ভয়ের">👻 রহস্য / ভয়</option>
                          <option value="প্রেমের">💖 ভালোবাসার</option>
                          <option value="হাসির">🤡 হাসির / কৌতুক</option>
                          <option value="অ্যাডভেঞ্চার">🧭 অ্যাডভেঞ্চার</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase tracking-wider text-gray-400 mb-1.5 font-bold">দীর্ঘতা (Duration)</label>
                        <select
                          value={storyDuration}
                          onChange={(e) => setStoryDuration(Number(e.target.value))}
                          className="w-full bg-[#121214] border border-white/10 rounded-xl p-2 text-xs text-white focus:outline-none focus:border-violet-500"
                        >
                          <option value={1}>⏱️ ১ মিনিট গল্প (1m)</option>
                          <option value={3}>⏱️ ৩ মিনিট গল্প (3m)</option>
                          <option value={5}>⏱️ ৫ মিনিট গল্প (5m)</option>
                          <option value={10}>⏱️ ১০ মিনিট গল্প (10m)</option>
                        </select>
                      </div>
                    </div>

                    <button
                      onClick={handleGenerateStory}
                      disabled={isGeneratingStory}
                      className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold text-xs tracking-widest uppercase transition-all shadow-[0_4px_12px_rgba(139,92,246,0.25)] flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {isGeneratingStory ? (
                        <>
                          <Loader2 className="animate-spin" size={14} />
                          গল্প বুনছি ভাইয়া...
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} className="text-pink-300 animate-pulse" />
                          গল্প শুরু করো (Start Story)
                        </>
                      )}
                    </button>
                  </div>

                  {generatedStory && (
                    <div className="p-4 bg-violet-950/10 border border-violet-500/20 rounded-2xl space-y-3 mt-4 text-left">
                      <div className="flex items-center justify-between text-[10px] text-violet-400 font-bold uppercase font-mono tracking-wider">
                        <span>📖 জোয়া শোনাচ্ছে:</span>
                        <span>{storyDuration} Min read</span>
                      </div>
                      <p className="text-xs text-slate-100 font-serif leading-relaxed whitespace-pre-line antialiased">
                        {generatedStory}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* === MEMORIES TAB === */}
              {activeTab === "memories" && (
                <div className="space-y-5 text-left">
                  <div className="p-4 bg-white/5 border border-white/5 rounded-2xl flex items-center gap-3">
                    <Brain className="text-pink-400" size={24} />
                    <div>
                      <p className="text-xs font-bold text-white">জোয়ার স্মৃতিভাণ্ডার</p>
                      <p className="text-[10px] text-gray-400 font-serif leading-relaxed">
                        বসের সাথে করা গল্প ও লাইভ চ্যাট থেকে সংগৃহীত জ্ঞান।
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-widest text-[#00E5FF] font-mono uppercase">MEMORIES LOADED ({memories.length})</span>
                      {memories.length > 0 && (
                        <button
                          onClick={handleClearMemories}
                          className="text-[9px] text-red-400 hover:text-red-300 transition-colors uppercase font-bold text-right cursor-pointer"
                        >
                          স্মৃতি মুছুন
                        </button>
                      )}
                    </div>

                    {memories.length === 0 ? (
                      <div className="py-12 border border-dashed border-white/5 rounded-2xl text-center px-4 flex flex-col items-center">
                        <span className="text-xl opacity-40">🧠</span>
                        <p className="text-xs text-gray-400 font-serif mt-2 text-center">বসের কোনো স্মৃতি সংগৃহীত হয়নি। কথা বলা শুরু করো!</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {memories.map((m) => (
                          <div
                            key={m.key}
                            className="p-3 rounded-xl bg-white/5 border border-white/5 flex items-start justify-between text-xs text-left"
                          >
                            <div className="pr-4">
                              <p className="font-bold text-[#00E5FF] uppercase text-[9px] tracking-wider mb-0.5">{m.key.replace(/_/g, " ")}</p>
                              <p className="text-white/90 font-serif leading-normal">{m.value}</p>
                            </div>
                            <button
                              onClick={async () => {
                                if (confirm("এই নির্দিষ্ট স্মৃতিটি ডিলিট করতে চান?")) {
                                  const res = await fetch(`/api/memories/${encodeURIComponent(m.key)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    loadMemories();
                                  }
                                }
                              }}
                              className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                              title="Delete Memory Fact"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
