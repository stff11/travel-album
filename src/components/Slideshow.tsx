import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Pause,
  Play,
  Shuffle,
  X,
  ZoomIn,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { photoUrl, placeholderUrl, LIGHTBOX_WIDTH } from "@/lib/photoUrl";
import { prefetchImage, retainHighPriority } from "@/lib/imagePrefetch";
import { prefetchPhotoPlace } from "@/lib/photoPlace";
import {
  enterFullscreen,
  exitFullscreen,
  fullscreenSupported,
  isFullscreen,
  onFullscreenChange,
} from "@/lib/fullscreen";
import { PhotoCaption } from "@/components/PhotoCaption";

export type SlidePhoto = {
  id: number;
  filename: string;
  originalName: string;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
};

const SPEEDS = [3, 5, 8, 12, 20] as const;
const DEFAULT_SECONDS = 6;
const CROSSFADE_S = 1;
const HIDE_CONTROLS_AFTER_MS = 3000;
const SETTINGS_KEY = "wl:slideshow";
const TRANSFORM_ORIGINS = ["50% 50%", "30% 40%", "70% 40%", "50% 70%"];

type Settings = { seconds: number; shuffle: boolean; zoom: boolean };

function loadSettings(): Settings {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const defaults: Settings = { seconds: DEFAULT_SECONDS, shuffle: false, zoom: !prefersReducedMotion };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const seconds =
      typeof parsed.seconds === "number" && parsed.seconds >= 1 && parsed.seconds <= 120
        ? parsed.seconds
        : defaults.seconds;
    return {
      seconds,
      shuffle: typeof parsed.shuffle === "boolean" ? parsed.shuffle : defaults.shuffle,
      zoom: prefersReducedMotion ? false : typeof parsed.zoom === "boolean" ? parsed.zoom : defaults.zoom,
    };
  } catch {
    return defaults;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* private mode — settings just won't persist */
  }
}

/** Natural order starting at `current`, or a random order that begins with it. */
function makeOrder(n: number, current: number, shuffle: boolean): { order: number[]; pos: number } {
  if (!shuffle) return { order: Array.from({ length: n }, (_, i) => i), pos: current };
  const rest = Array.from({ length: n }, (_, i) => i).filter((i) => i !== current);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return { order: [current, ...rest], pos: 0 };
}

/** One photo, faded in over the previous one. */
function Slide({
  photo,
  zoom,
  seconds,
  playing,
  originIndex,
  onLoaded,
  onBroken,
}: {
  photo: SlidePhoto;
  zoom: boolean;
  seconds: number;
  playing: boolean;
  originIndex: number;
  onLoaded: () => void;
  onBroken: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoaded = useCallback(() => {
    setLoaded(true);
    onLoaded();
  }, [onLoaded]);

  // Cached images can already be complete before React attaches onLoad.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) handleLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      // The old photo stays fully visible until the new one has faded in over
      // it, then disappears — a true crossfade without a dip to black.
      exit={{ opacity: 0, transition: { delay: CROSSFADE_S, duration: 0.01 } }}
      transition={{ duration: CROSSFADE_S, ease: "easeInOut" }}
    >
      <img
        src={placeholderUrl(photo, 48)}
        alt=""
        aria-hidden="true"
        className={cn(
          "absolute inset-0 w-full h-full object-contain blur-xl scale-105 transition-opacity duration-500",
          loaded ? "opacity-0" : "opacity-100",
        )}
        draggable={false}
      />
      <img
        ref={imgRef}
        src={photoUrl(photo, LIGHTBOX_WIDTH)}
        alt={photo.originalName}
        className={cn(
          "relative max-w-full max-h-full object-contain select-none transition-opacity duration-500",
          loaded ? "opacity-100" : "opacity-0",
        )}
        style={
          zoom && loaded
            ? {
                // Slow, gentle push-in; keeps going through the crossfade.
                animation: `wl-kenburns ${seconds + CROSSFADE_S}s linear forwards`,
                animationPlayState: playing ? "running" : "paused",
                transformOrigin: TRANSFORM_ORIGINS[originIndex % TRANSFORM_ORIGINS.length],
              }
            : undefined
        }
        onLoad={handleLoaded}
        onError={onBroken}
        draggable={false}
      />
    </motion.div>
  );
}

function IconButton({
  label,
  onClick,
  active,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "w-10 h-10 rounded-full flex items-center justify-center text-white transition-colors backdrop-blur-md border border-white/10",
        active ? "bg-primary/30 text-primary border-primary/40" : "bg-white/10 hover:bg-white/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Full-screen, hands-free slideshow.
 *
 * Space / K pause · ← → previous / next · F full screen · Esc close.
 * Controls fade away after 3 s without movement; move the mouse or tap to bring
 * them back. Settings (seconds per photo, shuffle, gentle zoom) are remembered.
 */
export function Slideshow({
  photos,
  startIndex,
  title,
  onClose,
}: {
  photos: SlidePhoto[];
  startIndex: number;
  title?: string;
  /** `lastPhotoId` is the photo that was showing when the slideshow ended. */
  onClose: (lastPhotoId: number | null) => void;
}) {
  const queryClient = useQueryClient();
  const n = photos.length;
  const rootRef = useRef<HTMLDivElement>(null);

  const [settings, setSettings] = useState<Settings>(loadSettings);
  const { seconds, shuffle, zoom } = settings;
  const intervalMs = seconds * 1000;
  const updateSettings = (patch: Partial<Settings>) =>
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });

  const [seq, setSeq] = useState(() =>
    makeOrder(n, Math.min(Math.max(startIndex, 0), n - 1), loadSettings().shuffle),
  );
  const [tick, setTick] = useState(0); // +1 on every change of photo (also re-keys the slide)
  const [playing, setPlaying] = useState(true);
  const [readyTick, setReadyTick] = useState(-1);
  const ready = readyTick === tick;

  const currentIndex = seq.order[seq.pos] ?? 0;
  const photo = photos[currentIndex];

  const go = useCallback(
    (delta: number) => {
      if (n < 2) return;
      setSeq((s) => ({ ...s, pos: (s.pos + delta + n) % n }));
      setTick((t) => t + 1);
    },
    [n],
  );

  const toggleShuffle = () => {
    const next = !shuffle;
    updateSettings({ shuffle: next });
    setSeq(makeOrder(n, currentIndex, next)); // keep showing the same photo
  };

  // ---- auto-advance ---------------------------------------------------------
  // The clock only runs while playing AND the current photo has loaded, and it
  // keeps what was already elapsed across pause / resume.
  const elapsed = useRef(0);
  const startedAt = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
  }, [tick, seconds]);
  useEffect(() => {
    if (!playing || !ready || n < 2) return;
    startedAt.current = performance.now();
    const remaining = Math.max(0, intervalMs - elapsed.current);
    const timer = setTimeout(() => go(1), remaining);
    return () => {
      clearTimeout(timer);
      elapsed.current += performance.now() - startedAt.current;
    };
  }, [playing, ready, tick, seconds, intervalMs, n, go]);

  // A photo that fails to load is skipped (but never loop forever if all fail).
  const brokenStreak = useRef(0);
  const handleBroken = useCallback(() => {
    brokenStreak.current += 1;
    if (brokenStreak.current <= n) setTimeout(() => go(1), 400);
  }, [go, n]);
  const handleLoaded = useCallback(() => {
    brokenStreak.current = 0;
    setReadyTick(tick);
  }, [tick]);

  // ---- look ahead -----------------------------------------------------------
  useEffect(() => {
    const upcoming = [1, 2]
      .map((d) => photos[seq.order[(seq.pos + d) % n]])
      .filter((p): p is SlidePhoto => !!p && p.id !== photo?.id);
    const urls = upcoming.map((p) => photoUrl(p, LIGHTBOX_WIDTH));
    retainHighPriority(new Set(urls));
    urls.forEach((u) => void prefetchImage(u, "high"));
    // The caption of the next photo is ready by the time it appears.
    prefetchPhotoPlace(queryClient, upcoming[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq.pos, seq.order, n]);

  // ---- full screen ----------------------------------------------------------
  const [fs, setFs] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const photoIdRef = useRef<number | null>(photo?.id ?? null);
  photoIdRef.current = photo?.id ?? null;
  const wasFullscreen = useRef(false);
  const leavingViaButton = useRef(false);

  const close = useCallback(() => {
    void exitFullscreen();
    closeRef.current(photoIdRef.current);
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    el?.focus({ preventScroll: true });
    if (el && fullscreenSupported()) void enterFullscreen(el);

    const off = onFullscreenChange(() => {
      const now = isFullscreen();
      setFs(now);
      // Leaving full screen with Esc (or the browser's own controls) ends the
      // slideshow; leaving with our own button keeps it open in a window.
      if (!now && wasFullscreen.current && !leavingViaButton.current) {
        closeRef.current(photoIdRef.current);
      }
      leavingViaButton.current = false;
      wasFullscreen.current = now;
    });
    return () => {
      off();
      void exitFullscreen();
    };
  }, []);

  const toggleFullscreen = () => {
    if (isFullscreen()) {
      leavingViaButton.current = true;
      void exitFullscreen();
    } else if (rootRef.current) {
      void enterFullscreen(rootRef.current);
    }
  };

  // ---- keep the screen awake ------------------------------------------------
  useEffect(() => {
    type WakeLockSentinelLike = { release: () => Promise<void> };
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinelLike> };
        };
        const l = await nav.wakeLock?.request("screen");
        if (!l) return;
        if (cancelled) void l.release().catch(() => {});
        else lock = l;
      } catch {
        /* not supported / denied — the screen may dim, nothing else */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // ---- auto-hiding controls -------------------------------------------------
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const overControls = useRef(false);
  const poke = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(function hide() {
      if (overControls.current) {
        hideTimer.current = setTimeout(hide, HIDE_CONTROLS_AFTER_MS);
      } else {
        setControlsVisible(false);
      }
    }, HIDE_CONTROLS_AFTER_MS);
  }, []);
  useEffect(() => {
    poke();
    return () => clearTimeout(hideTimer.current);
  }, [poke]);

  // ---- keyboard -------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const onControl = tag === "BUTTON" || tag === "SELECT" || tag === "INPUT";
      switch (e.key) {
        case " ":
        case "k":
        case "K":
          if (onControl && e.key === " ") return; // let a focused button handle it
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "ArrowRight":
          go(1);
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "Escape":
          close();
          break;
        default:
          return;
      }
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, close, poke]);

  // ---- touch: swipe to move, tap to show / hide controls --------------------
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
      poke();
    }
  };
  const onRootClick = (e: React.MouseEvent) => {
    const pointerType = (e.nativeEvent as PointerEvent).pointerType;
    if (pointerType === "touch" || pointerType === "pen") {
      if (controlsVisible) {
        clearTimeout(hideTimer.current);
        setControlsVisible(false);
      } else {
        poke();
      }
    } else {
      poke();
    }
  };

  if (!photo) return null;

  const hidden = !controlsVisible;
  const controlLayer = cn(
    "transition-opacity duration-500",
    hidden && "opacity-0 pointer-events-none",
  );
  const hoverProps = {
    onPointerEnter: () => {
      overControls.current = true;
    },
    onPointerLeave: () => {
      overControls.current = false;
    },
  };

  return (
    <motion.div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Slideshow"
      data-testid="slideshow"
      data-playing={playing}
      data-controls={controlsVisible ? "visible" : "hidden"}
      data-index={currentIndex}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "fixed inset-0 z-[100] bg-black overflow-hidden outline-none select-none",
        hidden && "cursor-none",
      )}
      onPointerMove={(e) => e.pointerType === "mouse" && poke()}
      onClick={onRootClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Photos */}
      <AnimatePresence initial={false}>
        <Slide
          key={tick}
          photo={photo}
          zoom={zoom}
          seconds={seconds}
          playing={playing}
          originIndex={tick}
          onLoaded={handleLoaded}
          onBroken={handleBroken}
        />
      </AnimatePresence>

      {/* Readability gradients */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent",
          controlLayer,
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/60 to-transparent" />

      {/* Top bar */}
      <div
        className={cn("absolute top-0 inset-x-0 p-4 md:p-6 flex items-start justify-between gap-4", controlLayer)}
        {...hoverProps}
      >
        <div className="min-w-0 text-white">
          {title && <div className="font-serif text-lg md:text-xl truncate drop-shadow">{title}</div>}
          <div className="text-xs text-white/55 font-mono tracking-wide">
            {seq.pos + 1} / {n}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label={`Seconds per photo: ${seconds}. Click to change`}
            title="Seconds per photo"
            onClick={(e) => {
              e.stopPropagation();
              const i = SPEEDS.findIndex((s) => s === seconds);
              updateSettings({ seconds: SPEEDS[(i + 1) % SPEEDS.length] });
            }}
            className="h-10 min-w-10 px-3 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-mono backdrop-blur-md border border-white/10 transition-colors"
          >
            {seconds}s
          </button>
          <IconButton label="Shuffle" active={shuffle} onClick={toggleShuffle}>
            <Shuffle size={17} />
          </IconButton>
          <IconButton
            label="Gentle zoom"
            active={zoom}
            onClick={() => updateSettings({ zoom: !zoom })}
          >
            <ZoomIn size={18} />
          </IconButton>
          {fullscreenSupported() && (
            <IconButton label={fs ? "Exit full screen" : "Full screen"} onClick={toggleFullscreen}>
              {fs ? <Minimize size={17} /> : <Maximize size={17} />}
            </IconButton>
          )}
          <IconButton label="Close slideshow" onClick={close}>
            <X size={20} />
          </IconButton>
        </div>
      </div>

      {/* Bottom: transport */}
      <div
        className={cn("absolute bottom-5 md:bottom-7 inset-x-0 flex items-center justify-center gap-3", controlLayer)}
        {...hoverProps}
      >
        <IconButton label="Previous photo" onClick={() => go(-1)} className="w-11 h-11">
          <ChevronLeft size={22} />
        </IconButton>
        <IconButton
          label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          className="w-14 h-14 bg-white/15"
        >
          {playing ? <Pause size={24} /> : <Play size={24} className="ml-0.5" />}
        </IconButton>
        <IconButton label="Next photo" onClick={() => go(1)} className="w-11 h-11">
          <ChevronRight size={22} />
        </IconButton>
      </div>

      {/* Where / when — stays visible when the controls fade away */}
      <div className="pointer-events-none absolute left-5 md:left-8 bottom-24 md:bottom-8 max-w-[calc(100vw-2.5rem)] md:max-w-[40vw]">
        <PhotoCaption key={photo.id} photo={photo} delayMs={0} className="text-base drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]" />
      </div>

      {/* Time left on this photo */}
      {ready && (
        <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/10">
          <div
            key={`${tick}-${seconds}`}
            data-testid="slideshow-progress"
            className="h-full bg-primary origin-left"
            style={{
              animation: `wl-progress ${seconds}s linear forwards`,
              animationPlayState: playing && n > 1 ? "running" : "paused",
            }}
          />
        </div>
      )}

      {/* Paused hint */}
      <AnimatePresence>
        {!playing && (
          <motion.div
            key="paused"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center text-white/90"
          >
            <Pause size={34} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
