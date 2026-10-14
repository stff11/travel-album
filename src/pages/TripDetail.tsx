import { useParams, useLocation } from "wouter";
import {
  useGetTrip,
  getGetTripQueryKey,
  useGetTripPhotos,
  getGetTripPhotosQueryKey,
  getListTripsQueryKey,
  getGetTripsMapQueryKey,
  getGetStatsQueryKey,
  useUpdateTrip,
  useDeleteTrip,
  useDeletePhoto,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { memo, useState, useEffect, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Calendar, MapPin as MapPinIcon, Check, X, Edit2, ChevronLeft, ChevronRight, CheckSquare, Square, Play } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  photoUrl,
  thumbUrl,
  thumbSrcSet,
  placeholderUrl,
  coverUrl as heroUrl,
  cardUrl,
  LIGHTBOX_WIDTH,
} from "@/lib/photoUrl";
import { useAuth, isUnauthorized } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { getTripsReturnUrl } from "@/lib/tripsReturn";
import { Slideshow } from "@/components/Slideshow";
import { PhotoCaption } from "@/components/PhotoCaption";
import {
  prefetchImage,
  prefetchAllowed,
  isPrefetched,
  retainHighPriority,
  cancelBackgroundPrefetch,
  fullSizeWarmCount,
} from "@/lib/imagePrefetch";

// How many thumbnails load immediately; the rest follow in batches of this size.
const THUMB_BATCH = 12;
// Safety cap for huge albums: thumbnails past this many are left to the
// browser's normal lazy loading instead of being fetched up front.
const THUMB_EAGER_MAX = 400;
// How many full-size photos to quietly download in the background per album
// (≈ 300–600 KB each). Raise for faster lightbox browsing, lower to save data.
const WARM_FULLSIZE_COUNT = 30;
// Lightbox: how many photos to fetch ahead of / behind the one being viewed.
const LIGHTBOX_AHEAD = 4;
const LIGHTBOX_BEHIND = 2;

type Photo = {
  id: number;
  filename: string;
  originalName: string;
  takenAt: string | null;
  createdAt: string;
  tripId: number | null;
  lat: number | null;
  lng: number | null;
  fileSize: number;
  width: number | null;
  height: number | null;
  mimeType: string;
  filePath: string;
  cloudinaryUrl?: string | null;
  cloudinaryPublicId?: string | null;
};

const THUMB_SIZES = "(min-width: 1024px) 16vw, (min-width: 768px) 20vw, 33vw";

/**
 * One grid thumbnail. It tracks its own "loaded" flag, so a thumbnail finishing
 * only re-renders itself — not the whole grid (the old shared Set re-rendered
 * every thumbnail each time any one image loaded).
 */
const Thumb = memo(function Thumb({
  photo,
  eager,
  priority,
  onLoaded,
  className = "",
}: {
  photo: Photo;
  /** true = start downloading now; false = browser decides (lazy, near viewport) */
  eager: boolean;
  priority: boolean;
  onLoaded?: () => void;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleLoaded = () => {
    setLoaded(true);
    onLoaded?.();
  };

  // Images served from the browser cache can be complete before React
  // attaches onLoad.
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) handleLoaded();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <img
      ref={imgRef}
      src={thumbUrl(photo, 400)}
      srcSet={thumbSrcSet(photo)}
      sizes={THUMB_SIZES}
      alt={photo.originalName}
      className={`w-full h-full object-cover transition-all duration-300 ${loaded ? "opacity-100" : "opacity-0"} ${className}`}
      loading={eager ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      onLoad={handleLoaded}
      // A broken image must still count as "done", or it would stall the
      // release of the next batch of thumbnails.
      onError={() => onLoaded?.()}
      draggable={false}
    />
  );
});

function Lightbox({
  photos,
  initialIndex,
  onClose,
  isAdmin,
  onSlideshow,
  onSetCover,
  onDelete,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  isAdmin: boolean;
  onSlideshow: (index: number) => void;
  onSetCover: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [loadedIds, setLoadedIds] = useState<Set<number>>(() => new Set());
  const photo = photos[index];

  const markLoaded = useCallback((photoId: number) => {
    setLoadedIds((prev) => (prev.has(photoId) ? prev : new Set(prev).add(photoId)));
  }, []);

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIndex((i) => Math.min(photos.length - 1, i + 1)), [photos.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, prev, next]);

  // Fetch the photos around the current one at full size, nearest first, a few
  // more in the direction of travel than behind. Requests go through the shared
  // queue (limited concurrency, stale ones dropped when you skip ahead).
  useEffect(() => {
    const order: number[] = [];
    for (let d = 1; d <= Math.max(LIGHTBOX_AHEAD, LIGHTBOX_BEHIND); d++) {
      if (d <= LIGHTBOX_AHEAD) order.push(index + d);
      if (d <= LIGHTBOX_BEHIND) order.push(index - d);
    }
    const targets = order
      .filter((i) => i >= 0 && i < photos.length)
      .map((i) => ({ photo: photos[i], url: photoUrl(photos[i], LIGHTBOX_WIDTH) }));

    retainHighPriority(new Set(targets.map((t) => t.url)));
    for (const { photo: p, url } of targets) {
      if (isPrefetched(url)) markLoaded(p.id);
      else prefetchImage(url, "high").then((ok) => ok && markLoaded(p.id));
    }
  }, [index, photos, markLoaded]);

  if (!photo) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        className="absolute top-5 right-5 z-10 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        onClick={onClose}
        aria-label="Close"
      >
        <X size={20} />
      </button>

      {photos.length > 1 && (
        <button
          className="absolute top-5 right-[4.5rem] z-10 h-10 pl-3 pr-4 rounded-full bg-white/10 hover:bg-white/20 flex items-center gap-2 text-white text-sm transition-colors"
          onClick={(e) => { e.stopPropagation(); onSlideshow(index); }}
          aria-label="Start slideshow"
          title="Start slideshow from this photo"
        >
          <Play size={15} className="fill-current" />
          <span className="hidden sm:inline">Slideshow</span>
        </button>
      )}

      <div className="absolute top-5 left-1/2 -translate-x-1/2 text-white/50 text-sm font-mono">
        {index + 1} / {photos.length}
      </div>

      {index > 0 && (
        <button
          className="absolute left-4 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          onClick={(e) => { e.stopPropagation(); prev(); }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      <ContextMenu>
        <ContextMenuTrigger asChild disabled={!isAdmin}>
          <div
            className="relative flex items-center justify-center max-w-[90vw] max-h-[86vh]"
            style={photo.width && photo.height ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Blurred placeholder — same aspect ratio, loads almost instantly,
                and fades out once the full-resolution image is ready. */}
            <img
              src={placeholderUrl(photo, 48)}
              alt=""
              aria-hidden="true"
              className={`absolute inset-0 w-full h-full object-contain blur-xl scale-105 transition-opacity duration-300 ${
                loadedIds.has(photo.id) ? "opacity-0" : "opacity-100"
              }`}
              draggable={false}
            />
            <motion.img
              key={photo.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              src={photoUrl(photo, LIGHTBOX_WIDTH)}
              alt={photo.originalName}
              className="relative max-w-[90vw] max-h-[86vh] object-contain select-none rounded"
              onContextMenu={(e) => isAdmin && e.stopPropagation()}
              onLoad={() => markLoaded(photo.id)}
              draggable={false}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="bg-card/95 backdrop-blur border-border/40 min-w-[160px]">
          <ContextMenuItem
            className="cursor-pointer"
            onClick={() => { onSetCover(photo.id); onClose(); }}
          >
            Set as Cover
          </ContextMenuItem>
          <ContextMenuItem
            className="cursor-pointer text-destructive focus:text-destructive"
            onClick={() => { onDelete(photo.id); onClose(); }}
          >
            Delete Photo
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Area / city and day of the photo being viewed */}
      <PhotoCaption
        key={photo.id}
        photo={photo}
        pill
        className="absolute bottom-4 inset-x-0 mx-auto w-fit max-w-[calc(100vw-2rem)]"
      />

      {index < photos.length - 1 && (
        <button
          className="absolute right-4 z-10 w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          onClick={(e) => { e.stopPropagation(); next(); }}
        >
          <ChevronRight size={22} />
        </button>
      )}
    </motion.div>
  );
}

export default function TripDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const { isAdmin, handleUnauthorized } = useAuth();
  const { toast } = useToast();

  const { data: trip, isLoading: tripLoading } = useGetTrip(id, {
    query: { enabled: !!id, queryKey: getGetTripQueryKey(id) },
  });
  const { data: photos, isLoading: photosLoading } = useGetTripPhotos(id, {
    query: { enabled: !!id, queryKey: getGetTripPhotosQueryKey(id) },
  });

  const updateTrip = useUpdateTrip();
  const deleteTrip = useDeleteTrip();
  const deletePhoto = useDeletePhoto();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [slideshowStart, setSlideshowStart] = useState<number | null>(null);
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((photoId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const photoList = (photos ?? []) as Photo[];
    setSelectedIds(new Set(photoList.map((p) => p.id)));
  }, [photos]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  // Signing out (or an expired session) must also leave select mode.
  useEffect(() => {
    if (!isAdmin && isSelectMode) exitSelectMode();
  }, [isAdmin, isSelectMode, exitSelectMode]);

  useEffect(() => {
    if (!isSelectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSelectMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelectMode, exitSelectMode]);

  // ---- Loading photos ahead of the person ----------------------------------
  // 1) Thumbnails: the first batch loads immediately. Each time a batch is
  //    nearly done, the next batch is released — so the whole grid fills in
  //    behind the scenes instead of only when you scroll to it. (Same <img>
  //    elements and srcset as the visible ones, so the right size is cached.)
  const [eagerCount, setEagerCount] = useState(THUMB_BATCH);
  const eagerCountRef = useRef(THUMB_BATCH);
  const loadedCountRef = useRef(0);
  const totalPhotos = photos?.length ?? 0;

  useEffect(() => {
    eagerCountRef.current = THUMB_BATCH;
    loadedCountRef.current = 0;
    setEagerCount(THUMB_BATCH);
  }, [id]);

  const onThumbLoaded = useCallback(() => {
    loadedCountRef.current += 1;
    if (
      loadedCountRef.current >= eagerCountRef.current - 4 &&
      eagerCountRef.current < Math.min(totalPhotos, THUMB_EAGER_MAX) &&
      prefetchAllowed()
    ) {
      eagerCountRef.current += THUMB_BATCH;
      setEagerCount(eagerCountRef.current);
    }
  }, [totalPhotos]);

  // 2) Full-size photos for the lightbox: once the first thumbnails are in
  //    (or after a short wait), quietly download the first WARM_FULLSIZE_COUNT
  //    photos at the exact size the lightbox uses, a few at a time at low
  //    priority, so opening any of them is instant.
  const firstBatchDone = eagerCount > THUMB_BATCH || totalPhotos <= THUMB_BATCH;
  useEffect(() => {
    const list = ((photos ?? []) as Photo[]).slice(0, fullSizeWarmCount(WARM_FULLSIZE_COUNT));
    if (list.length === 0) return;

    const start = () => {
      for (const p of list) prefetchImage(photoUrl(p, LIGHTBOX_WIDTH), "low");
    };
    const timer = setTimeout(start, firstBatchDone ? 300 : 2500);
    return () => {
      clearTimeout(timer);
      cancelBackgroundPrefetch();
    };
  }, [photos, firstBatchDone]);

  const startEdit = () => {
    if (isAdmin && trip) { setEditName(trip.name); setIsEditing(true); }
  };

  /** Runs an admin action; on 401 drops back to read-only, on error shows a toast. */
  const runAdmin = async (label: string, action: () => Promise<void>): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (err) {
      if (isUnauthorized(err)) {
        handleUnauthorized();
        toast({ variant: "destructive", title: "Admin sign-in required", description: "Your session has ended. Sign in again to continue." });
      } else {
        toast({ variant: "destructive", title: `${label} failed`, description: err instanceof Error ? err.message : undefined });
      }
      return false;
    }
  };

  /** After anything that changes photos/counts, refresh every view that shows them. */
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getGetTripPhotosQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTripsMapQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
  };

  const saveEdit = async () => {
    if (!trip || editName.trim() === "") { setIsEditing(false); return; }
    const ok = await runAdmin("Rename", async () => {
      await updateTrip.mutateAsync({ id, data: { name: editName.trim() } });
    });
    if (ok) refreshAll();
    setIsEditing(false);
  };

  const handleDeleteTrip = async () => {
    if (!confirm("Delete this trip and all its photos? This cannot be undone.")) return;
    const ok = await runAdmin("Delete trip", async () => {
      await deleteTrip.mutateAsync({ id });
    });
    if (ok) {
      queryClient.removeQueries({ queryKey: getGetTripQueryKey(id) });
      queryClient.removeQueries({ queryKey: getGetTripPhotosQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetTripsMapQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
      setLocation(getTripsReturnUrl());
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (!confirm("Delete this photo?")) return;
    const ok = await runAdmin("Delete photo", async () => {
      await deletePhoto.mutateAsync({ id: photoId });
    });
    if (ok) refreshAll();
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} photo${count === 1 ? "" : "s"}? This cannot be undone.`)) return;

    setIsDeleting(true);
    // Sequential on purpose: the server recounts the album after every delete.
    await runAdmin("Delete photos", async () => {
      for (const photoId of Array.from(selectedIds)) {
        await deletePhoto.mutateAsync({ id: photoId });
      }
    });
    refreshAll(); // also covers a partial failure
    exitSelectMode();
    setIsDeleting(false);
  };

  const handleSetCover = async (photoId: number) => {
    const ok = await runAdmin("Set cover", async () => {
      await updateTrip.mutateAsync({ id, data: { coverPhotoId: photoId } });
    });
    if (ok) refreshAll();
  };

  if (tripLoading) return <div className="h-full w-full bg-background animate-pulse" />;
  if (!trip) return <div className="p-8 text-muted-foreground">Trip not found.</div>;

  const coverPhoto = trip.coverPhotoPath
    ? { cloudinaryUrl: trip.coverCloudinaryUrl ?? null, filename: trip.coverPhotoPath.split("/").pop() ?? "" }
    : null;
  // Full-width banner (not a square crop). The 800px card image is already in
  // the browser cache from the trips page, so it shows instantly underneath
  // while the sharp 1920px version loads on top.
  const coverUrl = coverPhoto ? heroUrl(coverPhoto) : null;
  const coverPreview = coverPhoto ? cardUrl(coverPhoto, 800) : null;

  const photoList = (photos ?? []) as Photo[];
  const allSelected = photoList.length > 0 && selectedIds.size === photoList.length;

  return (
    <div className="h-full w-full overflow-y-auto bg-background flex flex-col relative">
      {/* Hero */}
      <div className="relative h-[55vh] md:h-[65vh] w-full shrink-0 overflow-hidden">
        {coverUrl ? (
          <>
            {coverPreview && (
              <img src={coverPreview} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
            )}
            <img
              src={coverUrl}
              alt={trip.name}
              className="absolute inset-0 w-full h-full object-cover"
              fetchPriority="high"
              decoding="async"
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-secondary flex items-center justify-center">
            <MapPinIcon className="w-16 h-16 text-muted-foreground opacity-20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

        {/* Nav */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
          <Link href={getTripsReturnUrl()}>
            <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 cursor-pointer transition-colors border border-white/10">
              <ArrowLeft size={20} />
            </div>
          </Link>
          {isAdmin && (
            <button
              onClick={handleDeleteTrip}
              title="Delete trip"
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-destructive hover:bg-black/60 cursor-pointer transition-colors border border-white/10"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>

        {/* Trip info */}
        <div className="absolute bottom-0 left-0 p-8 md:p-16 z-20 max-w-4xl">
          {isEditing ? (
            <div className="flex items-center gap-4 mb-4">
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-4xl md:text-5xl font-serif bg-transparent border-b border-primary/50 text-white rounded-none px-0 h-auto focus-visible:ring-0 focus-visible:border-primary placeholder:text-white/30"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              />
              <button onClick={saveEdit} className="p-2 bg-primary text-primary-foreground rounded-full hover:opacity-90">
                <Check size={20} />
              </button>
              <button onClick={() => setIsEditing(false)} className="p-2 bg-white/10 text-white rounded-full hover:bg-white/20">
                <X size={20} />
              </button>
            </div>
          ) : (
            <div className={`group flex items-center gap-4 mb-4 ${isAdmin ? "cursor-pointer" : ""}`} onClick={startEdit}>
              <h1 className="text-5xl md:text-7xl font-serif text-white tracking-tight drop-shadow-lg">{trip.name}</h1>
              {isAdmin && (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-white/10 rounded-full backdrop-blur-sm">
                  <Edit2 size={18} className="text-white" />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-6 text-sm text-gray-300 tracking-wide">
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-primary/80" />
              <span>
                {format(new Date(trip.startDate), "MMM d, yyyy")}
                {trip.startDate !== trip.endDate && ` — ${format(new Date(trip.endDate), "MMM d, yyyy")}`}
              </span>
            </div>
            {trip.locationName && (
              <div className="flex items-center gap-2">
                <MapPinIcon size={16} className="text-primary/80" />
                <span>{trip.locationName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Photo grid */}
      <div className="flex-1 p-6 md:p-10 z-10 -mt-8 relative">
        {/* Grid toolbar */}
        {!photosLoading && photoList.length > 0 && (
          <div className="flex items-center justify-between mb-4">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-medium">
              {isSelectMode && selectedIds.size > 0
                ? `${selectedIds.size} selected`
                : `${photoList.length} photos`}
            </span>
            <div className="flex items-center gap-2">
              {photoList.length > 1 && !isSelectMode && (
                <button
                  onClick={() => setSlideshowStart(0)}
                  className="flex items-center gap-2 text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  aria-label="Start slideshow"
                  title="Full-screen slideshow"
                >
                  <Play size={12} className="fill-current" />
                  Slideshow
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => isSelectMode ? exitSelectMode() : setIsSelectMode(true)}
                  className={`flex items-center gap-2 text-xs uppercase tracking-widest px-3 py-1.5 rounded-full border transition-colors ${
                    isSelectMode
                      ? "border-primary/60 text-primary bg-primary/10"
                      : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {isSelectMode ? <X size={12} /> : <CheckSquare size={12} />}
                  {isSelectMode ? "Cancel" : "Select"}
                </button>
              )}
            </div>
          </div>
        )}

        {photosLoading ? (
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square bg-secondary/50 animate-pulse rounded" />
            ))}
          </div>
        ) : photoList.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground border border-dashed border-border/50 rounded-2xl">
            No photos in this trip.
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-1"
          >
            {photoList.map((photo, i) => {
              const isSelected = selectedIds.has(photo.id);

              if (isSelectMode) {
                return (
                  <motion.div
                    key={photo.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.015, duration: 0.3 }}
                    className={`aspect-square relative overflow-hidden bg-secondary cursor-pointer select-none ${
                      isSelected ? "ring-2 ring-primary ring-inset" : ""
                    }`}
                    onClick={() => toggleSelect(photo.id)}
                  >
                    <Thumb photo={photo} eager={i < eagerCount} priority={i < 6} onLoaded={onThumbLoaded} className={isSelected ? "scale-95 brightness-75" : ""} />
                    <div className={`absolute inset-0 transition-colors duration-200 ${isSelected ? "bg-primary/20" : "bg-transparent hover:bg-black/20"}`} />
                    <div className={`absolute top-2 right-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                      isSelected
                        ? "bg-primary border-primary"
                        : "bg-black/40 border-white/60"
                    }`}>
                      {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                    </div>
                  </motion.div>
                );
              }

              const tile = (
                <motion.div
                  key={photo.id}
                  data-photo-id={photo.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: Math.min(i, 24) * 0.015, duration: 0.3 }}
                  className="aspect-square group relative overflow-hidden bg-secondary cursor-pointer"
                  onClick={() => setLightboxIndex(i)}
                >
                  <Thumb photo={photo} eager={i < eagerCount} priority={i < 6} onLoaded={onThumbLoaded} className="group-hover:scale-105" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                </motion.div>
              );

              // Only the admin gets the right-click menu (set cover / delete).
              if (!isAdmin) return tile;

              return (
                <ContextMenu key={photo.id}>
                  <ContextMenuTrigger asChild>{tile}</ContextMenuTrigger>
                  <ContextMenuContent className="bg-card/95 backdrop-blur border-border/40 min-w-[160px]">
                    <ContextMenuItem
                      className="cursor-pointer"
                      onClick={() => handleSetCover(photo.id)}
                    >
                      Set as Cover
                    </ContextMenuItem>
                    <ContextMenuItem
                      className="cursor-pointer text-destructive focus:text-destructive"
                      onClick={() => handleDeletePhoto(photo.id)}
                    >
                      Delete Photo
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </motion.div>
        )}
      </div>

      {/* Bulk action bar */}
      <AnimatePresence>
        {isAdmin && isSelectMode && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl bg-card/95 backdrop-blur-xl border border-border/50 shadow-2xl"
          >
            <button
              onClick={allSelected ? deselectAll : selectAll}
              className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
            >
              {allSelected ? <Square size={14} /> : <CheckSquare size={14} />}
              {allSelected ? "None" : "All"}
            </button>

            <div className="w-px h-5 bg-border/50" />

            <span className="text-sm text-muted-foreground min-w-[80px] text-center">
              {selectedIds.size === 0
                ? "Select photos"
                : `${selectedIds.size} selected`}
            </span>

            <div className="w-px h-5 bg-border/50" />

            <button
              onClick={handleBulkDelete}
              disabled={selectedIds.size === 0 || isDeleting}
              className="flex items-center gap-2 px-4 py-1.5 rounded-xl bg-destructive/90 hover:bg-destructive text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen lightbox */}
      <AnimatePresence>
        {lightboxIndex !== null && photoList.length > 0 && !isSelectMode && (
          <Lightbox
            photos={photoList}
            initialIndex={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            isAdmin={isAdmin}
            onSlideshow={(i) => { setLightboxIndex(null); setSlideshowStart(i); }}
            onSetCover={handleSetCover}
            onDelete={handleDeletePhoto}
          />
        )}
      </AnimatePresence>

      {/* Full-screen automatic slideshow */}
      <AnimatePresence>
        {slideshowStart !== null && photoList.length > 1 && !isSelectMode && (
          <Slideshow
            photos={photoList}
            startIndex={slideshowStart}
            title={trip.name}
            onClose={(lastPhotoId) => {
              setSlideshowStart(null);
              // Bring the grid to the photo the slideshow ended on.
              if (lastPhotoId != null) {
                setTimeout(() => {
                  document
                    .querySelector(`[data-photo-id="${lastPhotoId}"]`)
                    ?.scrollIntoView({ block: "center" });
                }, 60);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
