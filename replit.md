# WanderLens

A cinematic personal travel memory app — upload photos from your phone and they're automatically grouped into trips by GPS location and date, displayed on a fullscreen world map with a floating timeline.

## Run & Operate

- `pnpm run dev:server` — run the API server (port 8080)
- `pnpm run dev:client` — run the frontend (port 26093)
- `pnpm run typecheck` — full typecheck (libs + server + client)
- `pnpm run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- Single root package + shared `lib/` workspace packages, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (server), Vite (client)
- Frontend: React + Vite, Tailwind, shadcn/ui, react-leaflet, framer-motion

## Where things live

```
/src                        ← React frontend
/server                     ← Express API server
/lib/api-spec/openapi.yaml  ← OpenAPI contract (source of truth)
/lib/api-client-react/      ← Generated React Query hooks
/lib/api-zod/               ← Generated Zod schemas
/lib/db/                    ← Drizzle ORM schema + client
/vite.config.ts             ← Vite config (frontend)
/build.mjs                  ← esbuild script (server)
/tsconfig.client.json       ← TS config for frontend
/tsconfig.server.json       ← TS config for backend
/uploads/                   ← Uploaded photo files (runtime)
```

### Key source files

- `server/routes/photos.ts` — Upload, EXIF extraction, HEIC conversion, file serving
- `server/routes/trips.ts` — Trip CRUD + map pins + merge
- `server/routes/stats.ts` — Dashboard stats
- `server/lib/tripGrouping.ts` — 100km / 5-day trip grouping algorithm
- `src/lib/photoUrl.ts` — Cloudinary URL helpers
- `src/lib/uploadQueue.tsx` — Background upload queue (concurrency=1)

## Architecture decisions

- Trip grouping: photos >100km apart OR >5 days apart create separate trips; done at upload time via `assignPhotoToTrip`, with a `/api/photos/regroup` endpoint to re-run on all ungrouped photos
- HEIC conversion: server-side via `heic-convert` at upload time; stored as JPEG
- EXIF extraction: `exifr` library; falls back to `sharp` for dimensions if EXIF is unavailable
- Photos stored on Cloudinary; URLs constructed via helpers in `src/lib/photoUrl.ts`
- Files also served at `/api/photos/file/:filename` for local fallback
- Dark-by-default cinematic theme; CartoDB Dark Matter tiles for the world map
- Upload queue concurrency=1 to avoid trip-creation race conditions

## Product

- Dashboard: fullscreen world map with glowing trip pins, floating timeline, stats header
- Journeys: Apple Photos-inspired masonry grid of all trips with cover photos + merge mode
- Trip Detail: full-bleed cover, photo grid, rename trip, delete photos, fullscreen lightbox
- Upload: drag-and-drop zone supporting JPG, PNG, HEIC; background queue with status pill

## Gotchas

- `lib/api-zod/tsconfig.json` needs `"lib": ["es2022", "dom"]` for File/Blob types from the upload schema
- After DB schema changes: run `pnpm run typecheck:libs` then `pnpm --filter @workspace/db run push`
- `heic-convert` has no type declarations; stub at `server/types/heic-convert.d.ts`
- The root `tsconfig.json` is the solution file for composite libs only — server/client have their own tsconfig.server.json / tsconfig.client.json
- Orval codegen overwrites `lib/api-zod/src/index.ts` — it must only export from `./generated/api` (not the types/ subdir)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
