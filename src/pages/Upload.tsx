import { useState, useCallback, useRef } from "react";
import { useUploadQueue } from "@/lib/uploadQueue";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileImage, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

export default function Upload() {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { enqueue } = useUploadQueue();
  const [, setLocation] = useLocation();

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
        (f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)
      );
      setFiles((prev) => [...prev, ...validFiles]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      console.log("Original File Size:", e.target.files[0].size / 1024 / 1024, "MB");
      const validFiles = Array.from(e.target.files).filter(
        (f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)
      );
      setFiles((prev) => [...prev, ...validFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const startUpload = () => {
    if (files.length === 0) return;
    enqueue(files);
    setFiles([]);
    setLocation("/trips");
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
            Drop your photos and they'll upload in the background — HEIC conversion, location
            detection and trip grouping all happen automatically while you browse.
          </p>
        </header>

        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all duration-300 min-h-[300px]
            ${isDragging ? "border-primary bg-primary/5" : "border-border/50 bg-secondary/30 hover:bg-secondary/50"}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            multiple
            accept="image/*,.heic,.HEIC"
            onChange={handleFileSelect}
          />
          <motion.div
            animate={{ scale: isDragging ? 1.1 : 1 }}
            transition={{ type: "spring", stiffness: 300 }}
            className="w-20 h-20 mb-6 rounded-full bg-background shadow-lg flex items-center justify-center text-primary border border-border/50"
          >
            <UploadCloud size={32} />
          </motion.div>
          <h3 className="font-serif text-2xl text-foreground mb-2">Drop your memories here</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            Drag and drop images, or click to browse. Supports JPG, PNG, and HEIC straight from your
            phone.
          </p>
        </div>

        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-serif text-xl">
                  Ready to queue ({files.length})
                </h3>
                <Button
                  onClick={startUpload}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 px-8"
                >
                  Upload & Continue
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
                      <span className="text-xs text-center truncate w-full text-foreground/80">
                        {file.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(i);
                      }}
                      className="absolute -top-2 -right-2 bg-destructive text-white w-6 h-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-md hover:bg-destructive/80"
                    >
                      <X size={12} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
