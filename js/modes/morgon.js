/** Läge 1 — Morgonskärm (platshållare, byggs i eget arbetsobjekt). */
import { createPlaceholderMode } from "./placeholder.js";

export default createPlaceholderMode({
  id: "morgon",
  title: "Morgonskärm",
  icon: "sunrise",
  studentText: "God morgon! Här kommer dagens schema och information att visas.",
});
