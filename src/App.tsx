import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { UploadQueueProvider } from "@/lib/uploadQueue";
import { AuthProvider } from "@/lib/auth";
import { UploadStatus } from "@/components/UploadStatus";
import NotFound from "@/pages/not-found";
import Trips from "@/pages/Trips";

// Code-split the heavy pages: the Leaflet map (Dashboard) and the album view
// are not needed to paint the trips list.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const TripDetail = lazy(() => import("@/pages/TripDetail"));
const Upload = lazy(() => import("@/pages/Upload"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Data is only changed through this app, and every mutation invalidates
      // what it touches, so it's safe to treat results as fresh for a minute
      // (instant back/forward navigation, no refetch storm) and to keep them
      // in memory for 30 minutes.
      staleTime: 60_000,
      gcTime: 30 * 60_000,
    },
  },
});

function Router() {
  return (
    <Layout>
      <Suspense fallback={<div className="h-full w-full bg-background" />}>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/trips" component={Trips} />
        <Route path="/trips/:id" component={TripDetail} />
        <Route path="/upload" component={Upload} />
        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <UploadQueueProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
            <UploadStatus />
          </UploadQueueProvider>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
