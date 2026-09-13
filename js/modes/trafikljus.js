/** Läge 3 — Trafikljusur (platshållare, byggs i eget arbetsobjekt). */
import { createPlaceholderMode } from "./placeholder.js";

export default createPlaceholderMode({
  id: "trafikljus",
  title: "Trafikljusur",
  icon: "🚦",
  studentText: "Här kommer trafikljuset och nedräkningen att visas — stort och tydligt.",
});
