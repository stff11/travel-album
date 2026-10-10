import {
  createContext,
  useContext,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetStatsQueryKey,
  getListTripsQueryKey,
  getGetTripsMapQueryKey,
  getGetTripQueryKey,
  getGetTripPhotosQueryKey,
} from "@workspace/api-client-react";

export type FileStatus = "pending" | "uploading" | "done" | "error";

export interface QueuedFile {
  id: string;
  file: File;
  status: FileStatus;
  error?: string;
}

interface UploadQueueContextType {
  queue: QueuedFile[];
  enqueue: (files: File[]) => void;
  clearDone: () => void;
  total: number;
  done: number;
  failed: number;
  active: number;
}

const UploadQueueContext = createContext<UploadQueueContextType | null>(null);

// Keep at 1 per browser: the server serialises trip assignment with a database
// lock, but one-at-a-time also keeps memory/bandwidth use predictable.
const CONCURRENCY = 1;
const MAX_ATTEMPTS = 2; // one automatic retry for network errors / 5xx

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  // Files and bookkeeping live in refs, so the processing loop never has to
  // read React state (the old version ran its upload from inside a setState
  // updater, which React is allowed to call twice).
  const filesRef = useRef(new Map<string, File>());
  const pendingIds = useRef<string[]>([]);
  const activeCount = useRef(0);
  const touchedTrips = useRef(new Set<number>());
  const queryClient = useQueryClient();

  const updateFile = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setQueue((q) => q.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const refreshData = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTripsMapQueryKey() });
    // Albums that just received photos must refetch too.
    for (const tripId of touchedTrips.current) {
      queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(tripId) });
      queryClient.invalidateQueries({ queryKey: getGetTripPhotosQueryKey(tripId) });
    }
    touchedTrips.current.clear();
  }, [queryClient]);

  const uploadOne = useCallback(async (file: File): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch("/api/photos/upload", { method: "POST", body: formData });
        if (res.ok) {
          const photo = (await res.json().catch(() => null)) as { tripId?: number | null } | null;
          if (photo?.tripId != null) touchedTrips.current.add(photo.tripId);
          return;
        }
        lastError = new Error(`HTTP ${res.status}`);
        if (res.status < 500) break; // 4xx: retrying won't help
      } catch (err) {
        lastError = err; // network error — retry
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    throw lastError;
  }, []);

  const pump = useCallback(() => {
    while (activeCount.current < CONCURRENCY && pendingIds.current.length > 0) {
      const id = pendingIds.current.shift()!;
      const file = filesRef.current.get(id);
      if (!file) continue;

      activeCount.current += 1;
      updateFile(id, { status: "uploading" });

      uploadOne(file)
        .then(() => updateFile(id, { status: "done" }))
        .catch((err) =>
          updateFile(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed",
          }),
        )
        .finally(() => {
          filesRef.current.delete(id);
          activeCount.current -= 1;
          if (pendingIds.current.length === 0 && activeCount.current === 0) {
            refreshData(); // whole batch finished
          } else {
            pump();
          }
        });
    }
  }, [updateFile, uploadOne, refreshData]);

  const enqueue = useCallback(
    (files: File[]) => {
      const newItems: QueuedFile[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: "pending",
      }));

      for (const item of newItems) filesRef.current.set(item.id, item.file);
      setQueue((q) => [...q, ...newItems]);
      pendingIds.current.push(...newItems.map((f) => f.id));
      pump();
    },
    [pump],
  );

  const clearDone = useCallback(() => {
    setQueue((q) => q.filter((f) => f.status !== "done" && f.status !== "error"));
  }, []);

  const total = queue.length;
  const done = queue.filter((f) => f.status === "done").length;
  const failed = queue.filter((f) => f.status === "error").length;
  const active = queue.filter(
    (f) => f.status === "pending" || f.status === "uploading"
  ).length;

  return (
    <UploadQueueContext.Provider
      value={{ queue, enqueue, clearDone, total, done, failed, active }}
    >
      {children}
    </UploadQueueContext.Provider>
  );
}

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext);
  if (!ctx) throw new Error("useUploadQueue must be used within UploadQueueProvider");
  return ctx;
}
