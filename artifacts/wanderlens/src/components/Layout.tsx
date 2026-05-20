import { Link, useLocation } from "wouter";
import { Compass, Image as ImageIcon, UploadCloud, Map, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealthCheck, getHealthCheckQueryKey } from "@workspace/api-client-react";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60000 } });

  const navItems = [
    { href: "/", icon: Map, label: "Map" },
    { href: "/trips", icon: Compass, label: "Journeys" },
    { href: "/upload", icon: UploadCloud, label: "Archive" },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <nav className="w-20 md:w-64 border-r border-border bg-card flex flex-col justify-between p-4 z-50">
        <div>
          <div className="mb-12 flex items-center justify-center md:justify-start gap-3 pl-2">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
              <Compass size={20} />
            </div>
            <span className="hidden md:block font-serif text-xl tracking-wide font-medium">WanderLens</span>
          </div>
          <div className="space-y-4">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={cn(
                      "flex items-center gap-4 px-3 py-3 rounded-lg cursor-pointer transition-colors duration-300",
                      isActive 
                        ? "bg-secondary text-primary" 
                        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                    )}
                  >
                    <Icon size={22} strokeWidth={isActive ? 2.5 : 1.5} />
                    <span className={cn("hidden md:block text-sm tracking-wide", isActive ? "font-medium" : "font-normal")}>
                      {item.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
        <div className="pb-4 flex justify-center md:justify-start pl-2">
           <div className="flex items-center gap-2 text-xs text-muted-foreground" title={`Status: ${health?.status || 'checking...'}`}>
             <div className={cn("w-2 h-2 rounded-full animate-pulse", health?.status === 'ok' ? "bg-green-500" : "bg-primary/50")} />
             <span className="hidden md:block">System Status</span>
           </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative overflow-hidden">
        {children}
      </main>
    </div>
  );
}
