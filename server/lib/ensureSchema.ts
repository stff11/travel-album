import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Tiny self-migration, run once per server start (cold start on Netlify).
 *
 * Adds what this version of the app needs on an existing database, so deploying
 * does not depend on remembering to run `drizzle-kit push` first:
 *   - trips.country_code      (ISO code behind the "countries visited" count)
 *   - photos.place_name       (city/area shown while viewing a photo full size)
 *   - photos_trip_id_taken_at_idx (speeds up album pages and photo counts)
 *
 * Both statements are idempotent and only run when something is missing.
 */
let ready: Promise<void> | null = null;

async function migrate(): Promise<void> {
  const col = await pool.query(
    `select 1 from information_schema.columns
     where table_name = 'trips' and column_name = 'country_code' limit 1`,
  );
  if (col.rowCount === 0) {
    await pool.query(`alter table trips add column if not exists country_code text`);
    logger.info("Added trips.country_code");
  }

  const placeCol = await pool.query(
    `select 1 from information_schema.columns
     where table_name = 'photos' and column_name = 'place_name' limit 1`,
  );
  if (placeCol.rowCount === 0) {
    await pool.query(`alter table photos add column if not exists place_name text`);
    logger.info("Added photos.place_name");
  }

  const idx = await pool.query(
    `select 1 from pg_indexes where indexname = 'photos_trip_id_taken_at_idx' limit 1`,
  );
  if (idx.rowCount === 0) {
    await pool.query(
      `create index if not exists photos_trip_id_taken_at_idx on photos (trip_id, taken_at)`,
    );
    logger.info("Created photos_trip_id_taken_at_idx");
  }
}

export function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = migrate().catch((err) => {
      ready = null; // try again on the next request
      throw err;
    });
  }
  return ready;
}
