import { useGetStats, getGetStatsQueryKey, useGetTripsMap, getGetTripsMapQueryKey, useListTrips, getListTripsQueryKey } from "@workspace/api-client-react";
import { WorldMap } from "@/components/WorldMap";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { Link } from "wouter";
import { MapPin } from "lucide-react";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetStats({ query: { queryKey: getGetStatsQueryKey() }});
  const { data: mapPins, isLoading: mapLoading } = useGetTripsMap({ query: { queryKey: getGetTripsMapQueryKey() }});
  const { data: trips, isLoading: tripsLoading } = useListTrips({ query: { queryKey: getListTripsQueryKey() }});

  const isLoading = statsLoading || mapLoading || tripsLoading;

  return (
    <div className="relative w-full h-full bg-background">
      {/* Background Map */}
      <div className="absolute inset-0">
        {!mapLoading && mapPins && <WorldMap pins={mapPins} />}
      </div>

      {/* Map Overlay Vignette */}
      <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/20 to-transparent pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent pointer-events-none" />

      {/* Floating Timeline Panel */}
      <motion.div 
        initial={{ x: -50, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="absolute left-0 top-0 bottom-0 w-full md:w-96 p-8 flex flex-col z-10 overflow-y-auto"
      >
        <div className="space-y-10 mt-12 md:mt-0">
          {/* Stats Hero */}
          <div className="space-y-2">
            <h1 className="text-4xl font-serif tracking-tight">The Archive</h1>
            <div className="flex gap-4 text-sm text-muted-foreground tracking-widest uppercase">
              <span>{stats?.totalTrips || 0} Journeys</span>
              <span>&middot;</span>
              <span>{stats?.totalPhotos || 0} Captures</span>
            </div>
          </div>

          {/* Timeline List */}
          <div className="flex-1 space-y-8">
            <h2 className="text-xs uppercase tracking-[0.2em] text-primary/80 font-medium">Timeline</h2>
            
            {!isLoading && trips?.length === 0 ? (
              <div className="flex flex-col items-start gap-4 text-muted-foreground p-6 rounded-lg border border-border/50 bg-background/50 backdrop-blur-md">
                <MapPin className="text-primary/50" />
                <p className="text-sm leading-relaxed">The map is empty. Begin your archive by uploading your first journey.</p>
                <Link href="/upload" className="text-primary text-sm hover:underline">
                  Upload photos
                </Link>
              </div>
            ) : (
              <div className="space-y-6 border-l border-border/50 pl-6 ml-2 relative">
                {trips?.map((trip, i) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 + (i * 0.1), duration: 0.5 }}
                    key={trip.id} 
                    className="relative group"
                  >
                    <div className="absolute -left-[31px] top-1.5 w-3 h-3 rounded-full bg-background border-2 border-primary/50 group-hover:border-primary group-hover:scale-125 transition-all duration-300 shadow-[0_0_10px_rgba(250,204,21,0)] group-hover:shadow-[0_0_10px_rgba(250,204,21,0.5)]" />
                    <Link href={`/trips/${trip.id}`}>
                      <div className="cursor-pointer block space-y-1">
                        <span className="text-xs text-muted-foreground font-mono">
                          {format(new Date(trip.startDate), 'MMM yyyy')}
                        </span>
                        <h3 className="text-lg font-serif text-foreground/90 group-hover:text-primary transition-colors">{trip.name}</h3>
                        <p className="text-xs text-muted-foreground/70">{trip.photoCount} photos {trip.locationName ? `· ${trip.locationName}` : ''}</p>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
