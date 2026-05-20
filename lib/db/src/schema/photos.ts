import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  fileSize: integer("file_size").notNull(),
  fileHash: text("file_hash"),
  width: integer("width"),
  height: integer("height"),
  lat: real("lat"),
  lng: real("lng"),
  altitude: real("altitude"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  tripId: integer("trip_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, createdAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
