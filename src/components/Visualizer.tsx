import React, { useEffect, useRef } from "react";
import { motion } from "motion/react";
import zoyaAvatarFirst from "../assets/images/zoya_avatar_1779288639777.png";
import zoyaAvatarSecond from "../assets/images/zoya_pink_moon_1779357087172.png";

type VisualizerState = "idle" | "listening" | "processing" | "speaking";

interface VisualizerProps {
  state: VisualizerState;
  onToggle?: () => void;
  avatarType?: "first" | "second";
  hideInterface?: boolean;
}

interface Petal {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  angle: number;
  spinSpeed: number;
  opacity: number;
  swayFreq: number;
  swayAmp: number;
  swayOffset: number;
}

export default function Visualizer({ state, onToggle, avatarType = "first", hideInterface = false }: VisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const petalsRef = useRef<Petal[]>([]);
  const stateRef = useRef<VisualizerState>(state);
  const timeRef = useRef<number>(0);

  // Sync state changes with ref to avoid closures inside requestAnimationFrame
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Load avatar on mount/change
  useEffect(() => {
    const img = new Image();
    img.src = avatarType === "second" ? zoyaAvatarSecond : zoyaAvatarFirst;
    img.onload = () => {
      imageRef.current = img;
    };
  }, [avatarType]);

  // Render Loop & Canvas Animations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    const initPetals = (w: number, h: number): Petal[] => {
      const arr: Petal[] = [];
      for (let i = 0; i < 48; i++) {
        arr.push({
          x: Math.random() * w,
          y: Math.random() * h - h,
          size: Math.random() * 8 + 5.5, // size 5.5px to 13.5px
          speedY: Math.random() * 1.3 + 0.7, // downward terminal speed
          speedX: Math.random() * 0.4 - 0.1, // general wind drift
          angle: Math.random() * Math.PI * 2,
          spinSpeed: (Math.random() - 0.5) * 0.025,
          opacity: Math.random() * 0.35 + 0.55,
          swayFreq: Math.random() * 0.01 + 0.007,
          swayAmp: Math.random() * 14 + 8,
          swayOffset: Math.random() * 100,
        });
      }
      return arr;
    };

    const resizeCanvas = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      if (petalsRef.current.length === 0) {
        petalsRef.current = initPetals(rect.width, rect.height);
      }
    };

    resizeCanvas();

    const resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

    // Organic Cherry Blossom Petal Drawing Function
    const drawPetal = (cCtx: CanvasRenderingContext2D, p: Petal) => {
      cCtx.save();
      cCtx.translate(p.x, p.y);
      cCtx.rotate(p.angle);
      
      cCtx.beginPath();
      cCtx.ellipse(0, 0, p.size, p.size * 0.65, 0, 0, Math.PI * 2);

      const grad = cCtx.createRadialGradient(-p.size / 3, -p.size / 3, 0, 0, 0, p.size);
      grad.addColorStop(0, `rgba(255, 208, 222, ${p.opacity})`);
      grad.addColorStop(0.75, `rgba(255, 145, 172, ${p.opacity * 0.95})`);
      grad.addColorStop(1, `rgba(242, 105, 135, ${p.opacity * 0.7})`);
      
      cCtx.fillStyle = grad;
      cCtx.fill();

      // Delicate cherry petal indent style
      cCtx.beginPath();
      cCtx.moveTo(p.size, 0);
      cCtx.lineTo(p.size + 1.8, -1.2);
      cCtx.lineTo(p.size + 1.8, 1.2);
      cCtx.closePath();
      cCtx.fillStyle = `rgba(240, 100, 130, ${p.opacity * 0.82})`;
      cCtx.fill();

      cCtx.restore();
    };

    // Draw frame-by-frame
    const render = () => {
      timeRef.current += 1;
      const t = timeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.clearRect(0, 0, w, h);

      const img = imageRef.current;
      let drawW = w;
      let drawH = h;
      let drawX = 0;
      let drawY = 0;

      if (img) {
        const imgRatio = img.width / img.height;
        const canvasRatio = w / h;

        if (imgRatio > canvasRatio) {
          drawH = h;
          drawW = h * imgRatio;
          drawY = 0;
          drawX = (w - drawW) / 2;
        } else {
          drawW = w;
          drawH = w / imgRatio;
          drawX = 0;
          drawY = (h - drawH) / 2;
        }

        ctx.save();

        // 1. Core Breath Animations (Slight rhythmic zoom & translate to simulate breathing)
        const currentState = stateRef.current;
        let scaleSway = 1.0;
        let transY = 0;

        if (currentState === "speaking") {
          scaleSway = 1.0025 + Math.sin(t * 0.1) * 0.002;
          transY = Math.sin(t * 0.08) * 0.9;
        } else if (currentState === "listening") {
          scaleSway = 1.0012 + Math.sin(t * 0.04) * 0.001;
          transY = Math.sin(t * 0.035) * 0.5;
        } else {
          scaleSway = 1.0006 + Math.sin(t * 0.02) * 0.0006;
          transY = Math.sin(t * 0.018) * 0.25;
        }

        ctx.translate(w / 2, h / 2);
        ctx.scale(scaleSway, scaleSway);
        ctx.translate(-w / 2, -h / 2);

        // Draw background base anime image (85% opacity, slightly faded to merge with depth)
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img, drawX, drawY + transY, drawW, drawH);
        ctx.globalAlpha = 1.0;

        ctx.restore(); // end breathing container adjustments
      } else {
        ctx.fillStyle = "#020203";
        ctx.fillRect(0, 0, w, h);
      }

      // 2. Sakura Petals Physics updates "ফুল যেন সব নড়ে"
      const petals = petalsRef.current;
      petals.forEach((p) => {
        p.angle += p.spinSpeed;
        p.y += p.speedY;

        const swayFactor = Math.sin(t * p.swayFreq + p.swayOffset) * p.swayAmp * 0.14;
        p.x += p.speedX + swayFactor;

        // Loop petals to the top if they fall off
        if (p.y > h + 15 || p.x > w + 15 || p.x < -15) {
          p.y = -22;
          p.x = Math.random() * w;
          p.opacity = Math.random() * 0.35 + 0.55;
        }

        drawPetal(ctx, p);
      });

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
    };
  }, [avatarType]);

  // Futuristically responsive HUD animations overlay parameters
  const getRingAnimation = (index: number, reverse: boolean = false) => {
    const baseSpeed = state === "listening" ? 3.5 : state === "processing" ? 1.8 : state === "speaking" ? 2.2 : 16;
    return {
      rotate: reverse ? [-360, 0] : [0, 360],
      transition: { duration: baseSpeed + index * 2.2, repeat: Infinity, ease: "linear" }
    };
  };

  const getPulseAnimation = () => {
    if (state === "speaking") {
      return {
        scale: [1, 1.06, 0.97, 1.03, 1],
        opacity: [0.84, 1, 0.84, 1, 0.84],
        transition: { duration: 0.48, repeat: Infinity, ease: "easeInOut" }
      };
    }
    if (state === "listening") {
      return {
        scale: [1, 1.03, 1],
        opacity: [0.72, 1, 0.72],
        transition: { duration: 0.9, repeat: Infinity, ease: "easeInOut" }
      };
    }
    if (state === "processing") {
      return {
        scale: [0.97, 1.03, 0.97],
        opacity: [0.62, 0.92, 0.62],
        transition: { duration: 0.75, repeat: Infinity, ease: "linear" }
      };
    }
    return {
      scale: [1, 1.015, 1],
      opacity: [0.42, 0.64, 0.42],
      transition: { duration: 3.8, repeat: Infinity, ease: "easeInOut" }
    };
  };

  const getTheme = () => {
    switch (state) {
      case "listening": return { color: "rgba(139, 92, 246, 1)", glow: "shadow-violet-500/60", border: "border-violet-400" };
      case "processing": return { color: "rgba(56, 189, 248, 1)", glow: "shadow-sky-400/80", border: "border-sky-400" };
      case "speaking": return { color: "rgba(236, 72, 153, 1)", glow: "shadow-pink-500/80", border: "border-pink-400" };
      default: return { color: "rgba(6, 182, 212, 0.8)", glow: "shadow-cyan-500/40", border: "border-cyan-500/50" };
    }
  };

  const theme = getTheme();

  return (
    <div className="absolute inset-0 w-full h-full flex items-center justify-center overflow-hidden pointer-events-none select-none z-0">
      
      {/* 1. Fully-Animated Responsive Background Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-cover block pointer-events-none z-0"
      />

      {/* 2. Cyber HUD Hologram layout overlays directly loaded over the canvas */}
      {!hideInterface && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 w-full h-full">
          {/* Ambient surrounding glow */}
          <motion.div
            animate={getPulseAnimation()}
            className={`absolute w-[50%] h-[50%] rounded-full blur-[90px] ${theme.glow} pointer-events-none`}
            style={{ backgroundColor: theme.color, opacity: 0.12 }}
          />

          {/* Outer hud rings */}
          <motion.div
            animate={getRingAnimation(4, false)}
            className={`absolute w-[80dvw] h-[80dvw] max-w-[500px] max-h-[500px] rounded-full border-[1.2px] border-dashed ${theme.border} opacity-20`}
          />

          <motion.div
            animate={getRingAnimation(3, true)}
            className={`absolute w-[70dvw] h-[70dvw] max-w-[420px] max-h-[420px] rounded-full border-[2.2px] border-dotted ${theme.border} opacity-28`}
          />

          <motion.div
            animate={getRingAnimation(2, false)}
            className={`absolute w-[60dvw] h-[60dvw] max-w-[340px] max-h-[340px] rounded-full border-[1.2px] ${theme.border} border-t-transparent border-b-transparent opacity-35`}
          />

          <motion.div
            animate={getRingAnimation(1, true)}
            className={`absolute w-[48dvw] h-[48dvw] max-w-[270px] max-h-[270px] rounded-full border-[2.2px] border-dashed ${theme.border} opacity-45`}
          />

          <motion.div
            animate={getRingAnimation(0, false)}
            className={`absolute w-[38dvw] h-[38dvw] max-w-[210px] max-h-[210px] rounded-full border-[3.8px] border-dotted ${theme.border} opacity-65`}
          />

          {/* Dynamic Interactive Core Button Inside HUD */}
          <motion.div
            animate={getPulseAnimation()}
            onClick={onToggle}
            className={`absolute w-[150px] h-[150px] sm:w-[170px] sm:h-[170px] rounded-full border-[2px] ${theme.border} bg-black/75 backdrop-blur-md flex flex-col items-center justify-center shadow-[inset_0_0_25px_rgba(0,0,0,0.65)] cursor-pointer pointer-events-auto select-none transition-all duration-300 hover:scale-[1.05] active:scale-[0.95]`}
            style={{ boxShadow: `0 0 45px ${theme.color}, inset 0 0 25px ${theme.color}` }}
          >
            <div 
              className="font-bold tracking-[0.25em] text-2xl text-white font-serif"
              style={{ textShadow: `0 0 12px ${theme.color}, 0 0 25px ${theme.color}` }}
            >
              GIMI
            </div>
            
            <div className="mt-2 text-[9px] font-mono tracking-widest text-white/80 animate-pulse text-center px-1.5 uppercase font-bold">
              {state === "idle" && <span className="text-[#00E5FF]">TAP TO SPEAK</span>}
              {state === "listening" && <span className="text-violet-400">LISTENING</span>}
              {state === "processing" && <span className="text-sky-400">THINKING</span>}
              {state === "speaking" && <span className="text-pink-400">SPEAKING</span>}
            </div>
          </motion.div>
        </div>
      )}

    </div>
  );
}
