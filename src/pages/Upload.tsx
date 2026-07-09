import { useState, useCallback, useRef } from "react";
import { useUploadQueue } from "@/lib/uploadQueue";
import { motion, AnimatePresence } from "framer-motion";
import { UploadCloud, FileImage, X, FolderOpen } from "lucide-react";
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
      const droppedFiles = Array.from(e.dataTransfer.files).filter(
        (f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)
      );
      
      // Log size to verify if OS-level compression is occurring
      droppedFiles.forEach(f => 
        console.log(`Dropped File: ${f.name} | Size: ${(f.size / 1024 / 1024).toFixed(2)} MB`)
      );

      setFiles((prev) => [...prev, ...droppedFiles]);
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files).filter(
        (f) => f.type.startsWith("image/") || /\.heic$/i.test(f.name)
      );
      setFiles((prev) => [...prev, ...selectedFiles]);
    }
  };

  // NEW: Native File Picker to bypass Mac Photos "Virtual Export"
  const handleNativePicker = async () => {
    try {
      if (!("showOpenFilePicker" in window)) {
        alert("Native picker not supported in this browser.");
        return;
      }
      // @ts-ignore
      const handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ 
          description: 'Images', 
          accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.heic', '.HEIC'] } 
        }],
      });
      const selected = await Promise.all(handles.map((h: any) => h.getFile()));
      setFiles((prev) => [...prev, ...selected]);
    } catch (err) {
      console.log("Picker cancelled or error:", err);
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
          <h1 className="text-4xl md:text-5xl font-serif tracking-tight">Add to Archive</h1>
          <p className="text-muted-foreground">
            Upload high-resolution photos directly. For best quality, use the "Select Files" button below.
          </p>
        </header>

        <div
          className={`relative border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all duration-300 min-h-[300px]
            ${isDragging ? "border-primary bg-primary/5" : "border-border/50 bg-secondary/30"}`}
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
          <UploadCloud size={48} className="text-primary mb-4" />
          <h3 className="font-serif text-2xl mb-2">Drop memories here</h3>
          <p className="text-muted-foreground text-center max-w-sm">
            Drag & Drop or click to browse.
          </p>
          
          <Button 
            variant="outline" 
            className="mt-6 gap-2" 
            onClick={(e) => { e.stopPropagation(); handleNativePicker(); }}
          >
            <FolderOpen size={18} /> Select Files Directly (Highest Quality)
          </Button>
        </div>

        <AnimatePresence>
          {files.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="font-serif text-xl">Ready to queue ({files.length})</h3>
                <Button onClick={startUpload} className="px-8">Upload & Continue</Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {files.map((file, i) => (
                  <div key={i} className="bg-secondary rounded-lg p-3 relative group">
                    <div className="flex flex-col items-center gap-2">
                      <FileImage className="text-muted-foreground w-8 h-8" />
                      <span className="text-xs truncate w-full text-center">{file.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                    <button onClick={() => removeFile(i)} className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-1">
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}