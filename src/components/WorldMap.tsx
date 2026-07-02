import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { TripMapPin } from "@workspace/api-client-react";
import { Link } from "wouter";
import { thumbUrl } from "@/lib/photoUrl";

interface WorldMapProps {
  pins: TripMapPin[];
  className?: string;
}

// Custom icon for cinematic glowing dots
const createCustomIcon = () => {
  return L.divIcon({
    className: "bg-transparent border-none",
    html: `<div class="relative flex items-center justify-center w-6 h-6">
             <div class="absolute w-full h-full rounded-full bg-primary/30 animate-ping"></div>
             <div class="relative w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_2px_rgba(250,204,21,0.8)]"></div>
           </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
};

function MapUpdater({ pins }: { pins: TripMapPin[] }) {
  const map = useMap();
  useEffect(() => {
    if (pins.length > 0) {
      const bounds = L.latLngBounds(pins.map(p => [p.centerLat, p.centerLng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
    }
  }, [pins, map]);
  return null;
}

export function WorldMap({ pins, className = "w-full h-full" }: WorldMapProps) {
  const mapRef = useRef<L.Map>(null);

  // Fix Leaflet's default icon paths issue (though we use custom icons anyway)
  useEffect(() => {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
    });
  }, []);

  const customIcon = createCustomIcon();

  return (
    <div className={className}>
      <MapContainer
        center={[20, 0]}
        zoom={3}
        className="w-full h-full z-0"
        ref={mapRef}
        zoomControl={false}
      >
        {/* CartoDB Dark Matter Base Map */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png"
        />
        {pins.map((pin) => (
          <Marker 
            key={pin.id} 
            position={[pin.centerLat, pin.centerLng]}
            icon={customIcon}
          >
            <Popup className="cinematic-popup">
              <Link href={`/trips/${pin.id}`}>
                <div className="cursor-pointer group flex flex-col gap-2 w-48 p-1">
                  {pin.coverPhotoPath && (
                     <div className="w-full h-24 overflow-hidden rounded-md">
                       <img 
                         src={thumbUrl({ cloudinaryUrl: pin.coverCloudinaryUrl ?? null, filename: pin.coverPhotoPath?.split('/').pop() ?? '' }, 300)}
                         alt={pin.name}
                         className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                       />
                     </div>
                  )}
                  <div>
                    <h3 className="font-serif text-lg font-medium text-foreground">{pin.name}</h3>
                    <p className="text-xs text-muted-foreground">{new Date(pin.startDate).getFullYear()} &middot; {pin.photoCount} photos</p>
                  </div>
                </div>
              </Link>
            </Popup>
          </Marker>
        ))}
        <MapUpdater pins={pins} />
      </MapContainer>
    </div>
  );
}
