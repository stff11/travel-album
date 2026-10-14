import { AnimatePresence, motion } from "framer-motion";
import { format } from "date-fns";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePhotoPlace, type PlacePhoto } from "@/lib/photoPlace";

type CaptionPhoto = PlacePhoto & { takenAt: string | null };

function formatDay(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : format(d, "d MMM yyyy");
}

/**
 * "📍 Alghero · 12 Jun 2023" — the area/city and day of the photo.
 * Shows nothing for a photo that has neither a place nor a date. The place fades
 * in once it is known (photos without GPS simply show the date).
 */
export function PhotoCaption({
  photo,
  className,
  pill = false,
  delayMs = 400,
}: {
  photo: CaptionPhoto;
  className?: string;
  /** dark rounded background, for use over a photo */
  pill?: boolean;
  delayMs?: number;
}) {
  const { place } = usePhotoPlace(photo, delayMs);
  const date = formatDay(photo.takenAt);
  if (!place && !date) return null;

  return (
    <div
      className={cn(
        "pointer-events-none select-none flex items-center gap-2 text-sm text-white/90",
        pill && "px-3.5 py-1.5 rounded-full bg-black/55 backdrop-blur-sm whitespace-nowrap",
        className,
      )}
      data-testid="photo-caption"
    >
      <AnimatePresence initial={false}>
        {place && (
          <motion.span
            key={place}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex items-center gap-1.5 font-medium min-w-0"
            data-testid="photo-place"
          >
            <MapPin size={14} className="text-primary shrink-0" />
            <span className="truncate">{place}</span>
          </motion.span>
        )}
      </AnimatePresence>
      {place && date && <span className="text-white/35">·</span>}
      {date && <span className="text-white/65">{date}</span>}
    </div>
  );
}
