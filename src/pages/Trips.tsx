import {
  useListTrips,
  getListTripsQueryKey,
  useMergeTrips,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import { MapPin, GitMerge, X, CheckCircle2, ArrowRight } from "lucide-react";
import { thumbUrl } from "@/lib/photoUrl";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function Trips() {
  const { data: trips, isLoading } = useListTrips({
    query: { queryKey: getListTripsQueryKey() },
  });
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);

  const { mutate: mergeTrips, isPending: isMerging } = useMergeTrips({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
        exitMergeMode();
      },
    },
  });

  const canMerge = (trips?.length ?? 0) >= 2;

  function enterMergeMode() {
    setMergeMode(true);
    setSelected([]);
  }

  function exitMergeMode() {
    setMergeMode(false);
    setSelected([]);
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }

  function confirmMerge() {
    if (selected.length !== 2 || isMerging) return;
    const [sourceId, targetId] = selected;
    mergeTrips({ id: targetId, data: { sourceId } });
  }

  const sourceTrip = trips?.find((t) => t.id === selected[0]);
  const targetTrip = trips?.find((t) => t.id === selected[1]);

  return (
    <div className="h-full w-full overflow-y-auto p-8 md:p-12">
      <div className="max-w-7xl mx-auto space-y-12">
        <header className="flex items-start justify-between gap-4">
          <div className="space-y-4 max-w-2xl">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-4xl md:text-5xl font-serif tracking-tight"
            >
              Trips
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 }}
              className="text-muted-foreground text-lg leading-relaxed"
            >
              {mergeMode
                ? "Select two trips to merge — the second trip you pick will absorb the first."
                : "A cinematic archive of places seen and distances traveled."}
            </motion.p>
          </div>

          {canMerge && !isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="flex-shrink-0 mt-2"
            >
              {mergeMode ? (
                <button
                  onClick={exitMergeMode}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors text-sm"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={enterMergeMode}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors text-sm"
                >
                  <GitMerge className="w-4 h-4" />
                  Merge trips
                </button>
              )}
            </motion.div>
          )}
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div
                key={i}
                className="aspect-[4/5] bg-secondary/50 animate-pulse rounded-xl"
              />
            ))}
          </div>
        ) : trips?.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center p-24 border border-dashed border-border/50 rounded-2xl bg-secondary/10">
            <MapPin className="text-muted-foreground w-12 h-12 mb-6 opacity-50" />
            <h3 className="font-serif text-2xl text-foreground mb-2">
              No journeys yet
            </h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Upload your photos and we'll automatically group them into
              beautiful, cinematic trips based on time and location.
            </p>
            <Link
              href="/upload"
              className="bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-medium tracking-wide hover:opacity-90 transition-opacity"
            >
              Start Uploading
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[300px]">
            {trips?.map((trip, i) => {
              const url = trip.coverPhotoPath
                ? thumbUrl(
                    {
                      cloudinaryUrl: trip.coverCloudinaryUrl ?? null,
                      filename: trip.coverPhotoPath.split("/").pop() ?? "",
                    },
                    800
                  )
                : null;

              const isLarge = i % 5 === 0;
              const isSelected = selected.includes(trip.id);
              const selectionIndex = selected.indexOf(trip.id);
              const isSource = selectionIndex === 0;
              const isTarget = selectionIndex === 1;
              const isDisabled =
                mergeMode && selected.length === 2 && !isSelected;

              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{
                    delay: i * 0.05,
                    duration: 0.6,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  key={trip.id}
                  className={cn(
                    "group relative overflow-hidden rounded-xl bg-secondary",
                    isLarge ? "row-span-2" : "row-span-1",
                    mergeMode && "cursor-pointer",
                    isSelected &&
                      "ring-2 ring-offset-2 ring-offset-background",
                    isSource && "ring-amber-400",
                    isTarget && "ring-emerald-400",
                    isDisabled && "opacity-40"
                  )}
                  onClick={() => {
                    if (mergeMode) {
                      toggleSelect(trip.id);
                    } else {
                      navigate(`/trips/${trip.id}`);
                    }
                  }}
                >
                  {!mergeMode && (
                    <Link
                      href={`/trips/${trip.id}`}
                      className="absolute inset-0 z-10"
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {url ? (
                    <img
                      src={url}
                      alt={trip.name}
                      className={cn(
                        "absolute inset-0 w-full h-full object-cover transition-all duration-1000",
                        !mergeMode &&
                          "group-hover:scale-105 group-hover:brightness-75"
                      )}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-card">
                      <MapPin className="text-muted-foreground opacity-20 w-12 h-12" />
                    </div>
                  )}

                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-80 transition-opacity duration-500",
                      !mergeMode && "group-hover:opacity-100"
                    )}
                  />

                  {/* Selection badge */}
                  <AnimatePresence>
                    {isSelected && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.6 }}
                        className={cn(
                          "absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm",
                          isSource
                            ? "bg-amber-400/20 text-amber-300 border border-amber-400/40"
                            : "bg-emerald-400/20 text-emerald-300 border border-emerald-400/40"
                        )}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        {isSource ? "Merge from" : "Merge into"}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    className={cn(
                      "absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-1 transform transition-transform duration-500",
                      !mergeMode &&
                        "translate-y-2 group-hover:translate-y-0"
                    )}
                  >
                    <span className="tracking-widest uppercase text-primary font-medium">
                      {format(new Date(trip.startDate), "MMM yyyy")}
                    </span>
                    <h2 className="text-2xl font-serif text-white">
                      {trip.name}
                    </h2>
                    <p
                      className={cn(
                        "text-sm text-gray-300 transition-opacity duration-500",
                        mergeMode
                          ? "opacity-70"
                          : "opacity-0 group-hover:opacity-100 delay-100"
                      )}
                    >
                      {trip.photoCount} photos
                      {trip.locationName ? ` · ${trip.locationName}` : ""}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* Merge confirmation bar */}
      <AnimatePresence>
        {mergeMode && selected.length === 2 && (
          <motion.div
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 80 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 px-6 py-4 rounded-2xl bg-card border border-border shadow-2xl shadow-black/60 backdrop-blur-sm max-w-xl w-[calc(100vw-3rem)]"
          >
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Merge trips
              </p>
              <div className="flex items-center gap-2 text-sm font-medium truncate">
                <span className="text-amber-400 truncate">
                  {sourceTrip?.name}
                </span>
                <ArrowRight className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="text-emerald-400 truncate">
                  {targetTrip?.name}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {(sourceTrip?.photoCount ?? 0) +
                  (targetTrip?.photoCount ?? 0)}{" "}
                photos total · "{sourceTrip?.name}" will be deleted
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={exitMergeMode}
                className="px-3 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmMerge}
                disabled={isMerging}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <GitMerge className="w-3.5 h-3.5" />
                {isMerging ? "Merging…" : "Merge"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
