import { useState, useCallback, useRef } from "react";
import { useUploadPhoto, useRegroupPhotos, getGetStatsQueryKey, getListTripsQueryKey, getGetTripsMapQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, FileImage, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";

export default function Upload() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [groupingResult, setGroupingResult] = useState<{tripsCreated: number, photosGrouped: number} | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const uploadPhoto = useUploadPhoto();
  const regroupPhotos = useRegroupPhotos();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const validFiles = Array.from(e.dataTransfer.files).filter(
        f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic')
      );
      setFiles(prev => [...prev, ...validFiles]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const validFiles = Array.from(e.target.files).filter(
        f => f.type.startsWith('image/') || f.name.toLowerCase().endsWith('.heic')
      );
      setFiles(prev => [...prev, ...validFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const startUpload = async () => {
    if (files.length === 0) return;
    
    setUploading(true);
    setProgress(0);
    setGroupingResult(null);

    let successCount = 0;
    
    for (let i = 0; i < files.length; i++) {
      try {
        const formData = new FormData();
        formData.append('file', files[i]);
        
        // Use native fetch to bypass Orval wrapper constraints for FormData
        const response = await fetch('/api/photos/upload', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        successCount++;
      } catch (err) {
        console.error("Failed to upload", files[i].name, err);
      }
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    if (successCount > 0) {
      toast({
        title: "Upload complete",
        description: `Successfully uploaded ${successCount} photos. Analyzing metadata...`
      });

      // Trigger automatic trip grouping
      try {
        const result = await regroupPhotos.mutateAsync({});
        setGroupingResult(result);
        
        // Invalidate queries to update UI globally
        queryClient.invalidateQueries({ queryKey: getGetStatsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetTripsMapQueryKey() });
        
        // Clear queue
        setFiles([]);
      } catch (err) {
        toast({
          title: "Grouping failed",
          description: "Failed to automatically group photos into trips.",
          variant: "destructive"
        });
      }
    }

    setUploading(false);
  };

  return (
    <div className="h-full w-full overflow-y-auto p-8 md:p-12 bg-background flex flex-col items-center">
      <div className="w-full max-w-3xl space-y-8">
        <header className="text-center space-y-4">
          <motion.h1 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-serif tracking-tight text-foreground"
          >
            Add to Archive
          </motion.h1>
          <p className="text-muted-foreground">
            Upload your photos. WanderLens reads the embedded time and location data to automatically construct your journeys.
          </p>
        </header>

        <AnimatePresence mode="wait">
          {groupingResult && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-primary/10 border border-primary/30 p-6 rounded-xl flex items-start gap-4"
            >
              <div className="p-3 bg-primary/20 rounded-full text-primary">
                <Sparkles size={24} />
              </div>
              <div>
                <h3 className="font-serif text-xl text-primary-foreground">Archive Updated</h3>
                <p className="text-muted-foreground mt-1 text-sm">
                  We analyzed {groupingResult.photosGrouped} new photos and automatically structured them into {groupingResult.tripsCreated} new or existing journeys based on time and geography.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div 
          className={`relative border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all duration-300 min-h-[300px]
            ${isDragging ? 'border-primary bg-primary/5' : 'border-border/50 bg-secondary/30 hover:bg-secondary/50'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            multiple 
            accept="image/*,.heic,.HEIC"
            onChange={handleFileSelect}
            disabled={uploading}
          />
          
          <div className="w-20 h-20 mb-6 rounded-full bg-background shadow-lg flex items-center justify-center text-primary border border-border/50">
            <UploadCloud size={32} />
          </div>
          
          <h3 className="font-serif text-2xl text-foreground mb-2">Drop your memories here</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            Drag and drop images, or click to browse. Supports JPG, PNG, and HEIC files straight from your phone.
          </p>
        </div>

        {files.length > 0 && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-xl">Ready to archive ({files.length})</h3>
              <Button 
                onClick={startUpload} 
                disabled={uploading}
                className="bg-primary text-primary-foreground hover:bg-primary/90 px-8"
              >
                {uploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading {progress}%
                  </>
                ) : (
                  "Upload & Analyze"
                )}
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {files.map((file, i) => (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  key={`${file.name}-${i}`} 
                  className="bg-secondary rounded-lg p-3 relative group"
                >
                  <div className="flex flex-col items-center gap-2">
                    <FileImage className="text-muted-foreground w-8 h-8" />
                    <span className="text-xs text-center truncate w-full text-foreground/80">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  {!uploading && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="absolute -top-2 -right-2 bg-destructive text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md hover:bg-destructive/80"
                    >
                      ×
                    </button>
                  )}
                  {uploading && progress > Math.round((i / files.length) * 100) && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm rounded-lg flex items-center justify-center">
                      <CheckCircle2 className="text-primary w-8 h-8" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
