import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Loader2, AlertCircle, X } from "lucide-react";
import { useUploadQueue } from "@/lib/uploadQueue";

export function UploadStatus() {
  const { total, done, failed, active, clearDone } = useUploadQueue();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"uploading" | "done" | "error" | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (total === 0) return;

    if (active > 0) {
      setVisible(true);
      setPhase("uploading");
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      return;
    }

    // All settled
    if (failed > 0) {
      setPhase("error");
      setVisible(true);
    } else {
      setPhase("done");
      setVisible(true);
    }

    dismissTimer.current = setTimeout(() => {
      setVisible(false);
      setTimeout(clearDone, 400); // clear after exit animation
    }, 4000);

    return () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [active, total, done, failed, clearDone]);

  const dismiss = () => {
    setVisible(false);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    setTimeout(clearDone, 400);
  };

  const inFlight = total - done - failed;

  return (
    <AnimatePresence>
      {visible && phase && (
        <motion.div
          key="upload-status"
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl border backdrop-blur-md text-sm font-medium select-none"
          style={{
            background: "hsl(var(--card) / 0.92)",
            borderColor: "hsl(var(--border) / 0.5)",
            color: "hsl(var(--card-foreground))",
          }}
        >
          {phase === "uploading" && (
            <>
              <Loader2 size={18} className="animate-spin text-primary shrink-0" />
              <span>
                Uploading{" "}
                <span className="text-primary font-semibold">
                  {done + failed}/{total}
                </span>
                {inFlight > 0 && (
                  <span className="text-muted-foreground font-normal ml-1 text-xs">
                    · {inFlight} in progress
                  </span>
                )}
              </span>
            </>
          )}

          {phase === "done" && (
            <>
              <CheckCircle2 size={18} className="text-primary shrink-0" />
              <span>
                <span className="text-primary font-semibold">{done}</span>{" "}
                {done === 1 ? "photo" : "photos"} added to your archive
              </span>
            </>
          )}

          {phase === "error" && (
            <>
              <AlertCircle size={18} className="text-destructive shrink-0" />
              <span>
                {done > 0 && (
                  <>
                    <span className="text-primary font-semibold">{done}</span> uploaded
                    {"  ·  "}
                  </>
                )}
                <span className="text-destructive font-semibold">{failed}</span>{" "}
                failed
              </span>
            </>
          )}

          <button
            onClick={dismiss}
            className="ml-1 opacity-40 hover:opacity-80 transition-opacity"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
