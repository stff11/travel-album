import { relations } from "drizzle-orm";
import { tripsTable } from "./trips";
import { photosTable } from "./photos";

export const tripsRelations = relations(tripsTable, ({ one }) => ({
  coverPhoto: one(photosTable, {
    fields: [tripsTable.coverPhotoId],
    references: [photosTable.id],
  }),
}));

export const photosRelations = relations(photosTable, ({ one }) => ({
  trip: one(tripsTable, {
    fields: [photosTable.tripId],
    references: [tripsTable.id],
  }),
}));
