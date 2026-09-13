/** Läge 1 — Morgonskärm (platshållare, byggs i eget arbetsobjekt). */
import { createPlaceholderMode } from "./placeholder.js";

export default createPlaceholderMode({
  id: "morgon",
  title: "Morgonskärm",
  icon: "🌅",
  studentText: "God morgon! Här kommer dagens schema och information att visas.",
});
