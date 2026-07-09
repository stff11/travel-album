import { useParams, useLocation } from "wouter";
import {
  useGetTrip,
  getGetTripQueryKey,
  useGetTripPhotos,
  getGetTripPhotosQueryKey,
  useUpdateTrip,
  useDeleteTrip,
  useDeletePhoto,
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useState, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Trash2, Calendar, MapPin as MapPinIcon, Check, X, Edit2, ChevronLeft, ChevronRight, CheckSquare, Square } from "lucide-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { photoUrl, thumbUrl } from "@/lib/photoUrl";

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

function Lightbox({
  photos,
  initialIndex,
  onClose,
  onSetCover,
  onDelete,
}: {
  photos: Photo[];
  initialIndex: number;
  onClose: () => void;
  onSetCover: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const photo = photos[index];

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
      >
        <X size={20} />
      </button>

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
        <ContextMenuTrigger asChild>
          <motion.img
            key={photo.id}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            src={photoUrl(photo)}
            alt={photo.originalName}
            className="max-w-[90vw] max-h-[90vh] object-contain select-none rounded"
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            draggable={false}
          />
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

  useEffect(() => {
    if (!isSelectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitSelectMode();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelectMode, exitSelectMode]);

  const startEdit = () => {
    if (trip) { setEditName(trip.name); setIsEditing(true); }
  };

  const saveEdit = async () => {
    if (!trip || editName.trim() === "") { setIsEditing(false); return; }
    await updateTrip.mutateAsync({ id, data: { name: editName } });
    queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    setIsEditing(false);
  };

  const handleDeleteTrip = async () => {
    if (confirm("Delete this trip and all its photos? This cannot be undone.")) {
      await deleteTrip.mutateAsync({ id });
      setLocation("/trips");
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (confirm("Delete this photo?")) {
      await deletePhoto.mutateAsync({ id: photoId });
      queryClient.invalidateQueries({ queryKey: getGetTripPhotosQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`Delete ${count} photo${count === 1 ? "" : "s"}? This cannot be undone.`)) return;

    setIsDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedIds).map((photoId) =>
          deletePhoto.mutateAsync({ id: photoId })
        )
      );
      queryClient.invalidateQueries({ queryKey: getGetTripPhotosQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
      exitSelectMode();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSetCover = async (photoId: number) => {
    await updateTrip.mutateAsync({ id, data: { coverPhotoId: photoId } });
    queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
  };

  if (tripLoading) return <div className="h-full w-full bg-background animate-pulse" />;
  if (!trip) return <div className="p-8 text-muted-foreground">Trip not found.</div>;

  const coverUrl = trip.coverPhotoPath
    ? thumbUrl({ cloudinaryUrl: trip.coverCloudinaryUrl ?? null, filename: trip.coverPhotoPath.split("/").pop() ?? "" }, 1600)
    : null;

  const photoList = (photos ?? []) as Photo[];
  const allSelected = photoList.length > 0 && selectedIds.size === photoList.length;

  return (
    <div className="h-full w-full overflow-y-auto bg-background flex flex-col relative">
      {/* Hero */}
      <div className="relative h-[55vh] md:h-[65vh] w-full shrink-0 overflow-hidden">
        {coverUrl ? (
          <img src={coverUrl} alt={trip.name} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-secondary flex items-center justify-center">
            <MapPinIcon className="w-16 h-16 text-muted-foreground opacity-20" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

        {/* Nav */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
          <Link href="/trips">
            <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 cursor-pointer transition-colors border border-white/10">
              <ArrowLeft size={20} />
            </div>
          </Link>
          <button
            onClick={handleDeleteTrip}
            className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-destructive hover:bg-black/60 cursor-pointer transition-colors border border-white/10"
          >
            <Trash2 size={18} />
          </button>
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
            <div className="group flex items-center gap-4 mb-4 cursor-pointer" onClick={startEdit}>
              <h1 className="text-5xl md:text-7xl font-serif text-white tracking-tight drop-shadow-lg">{trip.name}</h1>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity p-2 bg-white/10 rounded-full backdrop-blur-sm">
                <Edit2 size={18} className="text-white" />
              </div>
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
            <div className="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full border border-white/10">
              {trip.photoCount} Captures
            </div>
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
                    <img
                      src={thumbUrl(photo, 400)}
                      alt={photo.originalName}
                      className={`w-full h-full object-cover transition-all duration-200 ${isSelected ? "scale-95 brightness-75" : ""}`}
                      loading="lazy"
                      draggable={false}
                    />
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

              return (
                <ContextMenu key={photo.id}>
                  <ContextMenuTrigger asChild>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: i * 0.015, duration: 0.3 }}
                      className="aspect-square group relative overflow-hidden bg-secondary cursor-pointer"
                      onClick={() => setLightboxIndex(i)}
                    >
                      <img
                        src={thumbUrl(photo, 400)}
                        alt={photo.originalName}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300" />
                    </motion.div>
                  </ContextMenuTrigger>
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
        {isSelectMode && (
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
            onSetCover={handleSetCover}
            onDelete={handleDeletePhoto}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
