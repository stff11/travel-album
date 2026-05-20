# WanderLens

A cinematic personal travel memory app — upload photos from your phone and they're automatically grouped into trips by GPS location and date, displayed on a fullscreen world map with a floating timeline.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/wanderlens run dev` — run the frontend (port 26093)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Frontend: React + Vite, Tailwind, shadcn/ui, react-leaflet, framer-motion

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/db/src/schema/photos.ts` — Photos table
- `lib/db/src/schema/trips.ts` — Trips table
- `artifacts/api-server/src/routes/photos.ts` — Upload, EXIF extraction, HEIC conversion, file serving
- `artifacts/api-server/src/routes/trips.ts` — Trip CRUD + map pins
- `artifacts/api-server/src/routes/stats.ts` — Dashboard stats
- `artifacts/api-server/src/lib/tripGrouping.ts` — 100km / 5-day trip grouping algorithm
- `artifacts/wanderlens/src/` — React frontend
- `artifacts/api-server/uploads/` — Uploaded photo files (runtime)

## Architecture decisions

- Trip grouping: photos >100km apart OR >5 days apart create separate trips; done at upload time via `assignPhotoToTrip`, with a `/api/photos/regroup` endpoint to re-run on all ungrouped photos
- HEIC conversion: server-side via `heic-convert` at upload time; stored as JPEG
- EXIF extraction: `exifr` library; falls back to `sharp` for dimensions if EXIF is unavailable
- Files served at `/api/photos/file/:filename` — frontend constructs URLs as `/api/photos/file/${photo.filename}`
- Dark-by-default cinematic theme; CartoDB Dark Matter tiles for the world map

## Product

- Dashboard: fullscreen world map with glowing trip pins, floating timeline, stats header
- Journeys: Apple Photos-inspired masonry grid of all trips with cover photos
- Trip Detail: full-bleed cover, photo grid, rename trip, delete photos
- Upload: drag-and-drop zone supporting JPG, PNG, HEIC; auto-groups into trips after upload

## Gotchas

- `@types/leaflet` must be installed in the wanderlens artifact (not root)
- `lib/api-zod/tsconfig.json` needs `"lib": ["es2022", "dom"]` for File/Blob types from the upload schema
- After DB schema changes: run `pnpm run typecheck:libs` then `pnpm --filter @workspace/db run push`
- `heic-convert` has no type declarations; stub at `artifacts/api-server/src/types/heic-convert.d.ts`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
