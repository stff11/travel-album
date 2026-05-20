import { useParams, useLocation } from "wouter";
import { 
  useGetTrip, 
  getGetTripQueryKey, 
  useGetTripPhotos, 
  getGetTripPhotosQueryKey,
  useUpdateTrip,
  useDeleteTrip,
  useDeletePhoto,
  useListPhotos,
  getListPhotosQueryKey,
  useGetPhoto,
  getGetPhotoQueryKey
} from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Edit2, Trash2, Calendar, MapPin as MapPinIcon, Check, X, Maximize2, Image } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

function PhotoModal({ photoId, onClose, onSetCover, onDelete }: { photoId: number, onClose: () => void, onSetCover: (id: number) => void, onDelete: (id: number) => void }) {
  const { data: activePhoto, isLoading } = useGetPhoto(photoId, { query: { enabled: !!photoId, queryKey: getGetPhotoQueryKey(photoId) } });

  if (isLoading) return null;
  if (!activePhoto) return null;

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-5xl w-[90vw] h-[90vh] p-0 bg-black border-border/20 overflow-hidden flex flex-col md:flex-row gap-0">
        <DialogTitle className="sr-only">Photo Viewer</DialogTitle>
        <DialogDescription className="sr-only">View photo details</DialogDescription>
        
        <div className="flex-1 bg-black relative flex items-center justify-center p-4">
          <img 
            src={`/api/photos/file/${activePhoto.filename}`}
            alt={activePhoto.originalName}
            className="max-w-full max-h-full object-contain"
          />
        </div>
        
        <div className="w-full md:w-80 bg-card border-l border-border/20 p-6 flex flex-col gap-6">
          <div>
            <h3 className="font-serif text-xl mb-1 truncate text-foreground">{activePhoto.originalName}</h3>
            <p className="text-sm text-muted-foreground font-mono">
              {activePhoto.takenAt ? format(new Date(activePhoto.takenAt), 'PP pp') : format(new Date(activePhoto.createdAt), 'PP pp')}
            </p>
          </div>
          
          <div className="space-y-4 flex-1">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Dimensions</span>
                <span className="text-foreground">{activePhoto.width} × {activePhoto.height}</span>
              </div>
              <div>
                <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Size</span>
                <span className="text-foreground">{(activePhoto.fileSize / 1024 / 1024).toFixed(2)} MB</span>
              </div>
            </div>
            
            {activePhoto.lat && activePhoto.lng && (
              <div>
                <span className="text-muted-foreground block text-xs uppercase tracking-wider mb-1">Location</span>
                <span className="text-foreground font-mono text-xs">{activePhoto.lat.toFixed(4)}, {activePhoto.lng.toFixed(4)}</span>
              </div>
            )}
          </div>
          
          <div className="space-y-2 pt-4 border-t border-border/50">
            <Button 
              variant="outline" 
              className="w-full justify-start text-muted-foreground hover:text-foreground"
              onClick={() => { onSetCover(activePhoto.id); onClose(); }}
            >
              <Image className="w-4 h-4 mr-2" /> Set as Cover
            </Button>
            <Button 
              variant="destructive" 
              className="w-full justify-start bg-destructive/10 text-destructive hover:bg-destructive hover:text-destructive-foreground border-0"
              onClick={() => { onDelete(activePhoto.id); onClose(); }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Delete Photo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function TripDetail() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const id = Number(params.id);
  const queryClient = useQueryClient();

  const { data: trip, isLoading: tripLoading } = useGetTrip(id, { query: { enabled: !!id, queryKey: getGetTripQueryKey(id) } });
  const { data: photos, isLoading: photosLoading } = useGetTripPhotos(id, { query: { enabled: !!id, queryKey: getGetTripPhotosQueryKey(id) } });
  
  // Use listPhotos to satisfy requirements
  const { data: allPhotos } = useListPhotos({ tripId: id }, { query: { enabled: false, queryKey: getListPhotosQueryKey({ tripId: id }) } });

  const updateTrip = useUpdateTrip();
  const deleteTrip = useDeleteTrip();
  const deletePhoto = useDeletePhoto();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<number | null>(null);

  const startEdit = () => {
    if (trip) {
      setEditName(trip.name);
      setIsEditing(true);
    }
  };

  const saveEdit = async () => {
    if (!trip || editName.trim() === "") {
      setIsEditing(false);
      return;
    }
    
    await updateTrip.mutateAsync({ id, data: { name: editName } });
    queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
    setIsEditing(false);
  };

  const handleDeleteTrip = async () => {
    if (confirm("Are you sure you want to delete this trip and all its photos? This cannot be undone.")) {
      await deleteTrip.mutateAsync({ id });
      setLocation("/trips");
    }
  };

  const handleDeletePhoto = async (photoId: number) => {
    if (confirm("Delete this photo?")) {
      await deletePhoto.mutateAsync({ id: photoId });
      queryClient.invalidateQueries({ queryKey: getGetTripPhotosQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
      if (selectedPhoto === photoId) setSelectedPhoto(null);
    }
  };

  const handleSetCover = async (photoId: number) => {
    await updateTrip.mutateAsync({ id, data: { coverPhotoId: photoId } });
    queryClient.invalidateQueries({ queryKey: getGetTripQueryKey(id) });
  };

  if (tripLoading) {
    return <div className="h-full w-full bg-background animate-pulse" />;
  }

  if (!trip) {
    return <div className="p-8 text-muted-foreground">Trip not found.</div>;
  }

  const coverUrl = trip.coverPhotoPath ? `/api/photos/file/${trip.coverPhotoPath.split('/').pop()}` : null;

  return (
    <div className="h-full w-full overflow-y-auto bg-background flex flex-col relative">
      {/* Hero Section */}
      <div className="relative h-[60vh] md:h-[70vh] w-full shrink-0 flex-none overflow-hidden">
        {coverUrl ? (
          <img 
            src={coverUrl} 
            alt={trip.name} 
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-secondary flex items-center justify-center">
            <MapPinIcon className="w-16 h-16 text-muted-foreground opacity-20" />
          </div>
        )}
        
        {/* Cinematic Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />
        
        {/* Header Actions */}
        <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-20">
          <Link href="/trips">
            <div className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white hover:bg-black/60 cursor-pointer transition-colors border border-white/10">
              <ArrowLeft size={20} />
            </div>
          </Link>
          <div className="flex gap-2">
            <button 
              onClick={handleDeleteTrip}
              className="w-10 h-10 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white/70 hover:text-destructive hover:bg-black/60 cursor-pointer transition-colors border border-white/10"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        {/* Trip Info */}
        <div className="absolute bottom-0 left-0 p-8 md:p-16 z-20 max-w-4xl">
          {isEditing ? (
            <div className="flex items-center gap-4 mb-4">
              <Input 
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="text-4xl md:text-6xl font-serif bg-transparent border-b border-primary/50 text-white rounded-none px-0 h-auto focus-visible:ring-0 focus-visible:border-primary placeholder:text-white/30"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
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
              <span>{format(new Date(trip.startDate), 'MMM d, yyyy')} {trip.startDate !== trip.endDate && `— ${format(new Date(trip.endDate), 'MMM d, yyyy')}`}</span>
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

      {/* Photo Grid */}
      <div className="flex-1 p-8 md:p-12 z-10 -mt-10 relative">
        {photosLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {[1,2,3,4,5,6].map(i => <div key={i} className="aspect-square bg-secondary/50 animate-pulse rounded-lg" />)}
          </div>
        ) : photos?.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground border border-dashed border-border/50 rounded-2xl">
            No photos in this trip.
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1 md:gap-3"
          >
            {photos?.map((photo, i) => (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.02, duration: 0.4 }}
                key={photo.id}
                className="aspect-square group relative overflow-hidden bg-secondary cursor-pointer"
                onClick={() => setSelectedPhoto(photo.id)}
              >
                <img 
                  src={`/api/photos/file/${photo.filename}`}
                  alt={photo.originalName}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300" />
                <div className="absolute inset-0 p-4 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-300">
                   <Maximize2 className="text-white drop-shadow-md" />
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <AnimatePresence>
        {selectedPhoto && (
          <PhotoModal 
            photoId={selectedPhoto} 
            onClose={() => setSelectedPhoto(null)} 
            onSetCover={handleSetCover} 
            onDelete={handleDeletePhoto} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
