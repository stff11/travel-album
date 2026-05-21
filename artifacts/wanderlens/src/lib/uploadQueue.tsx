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

const CONCURRENCY = 3;

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const processingCount = useRef(0);
  const pendingIds = useRef<string[]>([]);
  const queryClient = useQueryClient();

  const updateFile = useCallback((id: string, patch: Partial<QueuedFile>) => {
    setQueue((q) => q.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  const processNext = useCallback(async () => {
    if (processingCount.current >= CONCURRENCY) return;
    const id = pendingIds.current.shift();
    if (!id) return;

    processingCount.current += 1;
    updateFile(id, { status: "uploading" });

    // We need to read the file from the queue ref — use a closure snapshot
    setQueue((snapshot) => {
      const item = snapshot.find((f) => f.id === id);
      if (!item) {
        processingCount.current -= 1;
        return snapshot;
      }

      const doUpload = async () => {
        try {
          const formData = new FormData();
          formData.append("file", item.file);
          const res = await fetch("/api/photos/upload", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          updateFile(id, { status: "done" });
        } catch (err) {
          updateFile(id, {
            status: "error",
            error: err instanceof Error ? err.message : "Upload failed",
          });
        } finally {
          processingCount.current -= 1;
          // Kick off next in queue
          processNext();

          // When nothing is processing and pending queue is empty, refresh data
          setQueue((current) => {
            const stillBusy = current.some(
              (f) => f.status === "pending" || f.status === "uploading"
            );
            if (!stillBusy) {
              queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
              queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
              queryClient.invalidateQueries({ queryKey: getGetTripsMapQueryKey() });
            }
            return current;
          });
        }
      };

      doUpload();
      return snapshot;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateFile, queryClient]);

  const enqueue = useCallback(
    (files: File[]) => {
      const newItems: QueuedFile[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: "pending",
      }));

      setQueue((q) => [...q, ...newItems]);
      pendingIds.current.push(...newItems.map((f) => f.id));

      // Kick off up to CONCURRENCY processors
      for (let i = 0; i < Math.min(CONCURRENCY, newItems.length); i++) {
        processNext();
      }
    },
    [processNext]
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
