import { useListTrips, getListTripsQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { Link } from "wouter";
import { format } from "date-fns";
import { MapPin } from "lucide-react";

export default function Trips() {
  const { data: trips, isLoading } = useListTrips({ query: { queryKey: getListTripsQueryKey() }});

  return (
    <div className="h-full w-full overflow-y-auto p-8 md:p-12">
      <div className="max-w-7xl mx-auto space-y-12">
        <header className="space-y-4 max-w-2xl">
          <motion.h1 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl font-serif tracking-tight"
          >
            Journeys
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground text-lg leading-relaxed"
          >
            A cinematic archive of places seen and distances traveled.
          </motion.p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="aspect-[4/5] bg-secondary/50 animate-pulse rounded-xl" />
            ))}
          </div>
        ) : trips?.length === 0 ? (
           <div className="flex flex-col items-center justify-center text-center p-24 border border-dashed border-border/50 rounded-2xl bg-secondary/10">
              <MapPin className="text-muted-foreground w-12 h-12 mb-6 opacity-50" />
              <h3 className="font-serif text-2xl text-foreground mb-2">No journeys yet</h3>
              <p className="text-muted-foreground mb-6 max-w-md">Upload your photos and we'll automatically group them into beautiful, cinematic trips based on time and location.</p>
              <Link href="/upload" className="bg-primary text-primary-foreground px-6 py-3 rounded-md text-sm font-medium tracking-wide hover:opacity-90 transition-opacity">
                Start the Archive
              </Link>
           </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-[300px]">
            {trips?.map((trip, i) => {
              const coverUrl = trip.coverPhotoPath ? `/api/photos/file/${trip.coverPhotoPath.split('/').pop()}` : null;
              
              // Variable heights for a masonry-ish feel
              const isLarge = i % 5 === 0;
              
              return (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                  key={trip.id}
                  className={`group relative overflow-hidden rounded-xl bg-secondary ${isLarge ? 'row-span-2' : 'row-span-1'}`}
                >
                  <Link href={`/trips/${trip.id}`} className="absolute inset-0 z-10" />
                  
                  {coverUrl ? (
                    <img 
                      src={coverUrl} 
                      alt={trip.name}
                      className="absolute inset-0 w-full h-full object-cover transition-all duration-1000 group-hover:scale-105 group-hover:brightness-75"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-card">
                       <MapPin className="text-muted-foreground opacity-20 w-12 h-12" />
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
                  
                  <div className="absolute bottom-0 left-0 right-0 p-6 flex flex-col gap-1 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-500">
                    <span className="text-xs tracking-widest uppercase text-primary font-medium">
                      {format(new Date(trip.startDate), 'MMM yyyy')}
                    </span>
                    <h2 className="text-2xl font-serif text-white">{trip.name}</h2>
                    <p className="text-sm text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity duration-500 delay-100">
                      {trip.photoCount} photos {trip.locationName ? `· ${trip.locationName}` : ''}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
