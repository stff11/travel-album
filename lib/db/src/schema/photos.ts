import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tripsTable } from "./trips";

export const photosTable = pgTable("photos", {
  id: serial("id").primaryKey(),
  tripId: integer("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  mimeType: text("mime_type").notNull(),
  fileHash: text("file_hash").unique(),
  cloudinaryPublicId: text("cloudinary_public_id").notNull(),
  cloudinaryUrl: text("cloudinary_url").notNull(),
  lat: real("lat"),
  lng: real("lng"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPhotoSchema = createInsertSchema(photosTable).omit({ id: true, createdAt: true });
export type InsertPhoto = z.infer<typeof insertPhotoSchema>;
export type Photo = typeof photosTable.$inferSelect;
