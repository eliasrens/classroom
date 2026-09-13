/**
 * Hjälpare för lägen som ännu inte är byggda: skapar ett komplett
 * mode-objekt enligt MODULKONTRAKTET (se docs/MODULKONTRAKT.md)
 * med en platshållarvy. Respektive mode-issue ersätter sin modul
 * med en riktig implementation — kontraktets yta ska behållas.
 */
export function createPlaceholderMode({ id, title, icon, studentText }) {
  return {
    id,
    title,
    icon,

    async mount(el, ctx) {
      const isStudent = ctx.view === "student";
      const cls = ctx.activeClass;
      el.innerHTML = `
        <div class="mode-placeholder">
          <div class="mode-placeholder__icon">${icon}</div>
          <h1>${title}</h1>
          <p>${
            isStudent
              ? (studentText ?? "Elevskärmen för detta läge byggs i ett eget arbetsobjekt.")
              : `Läget <strong>${title}</strong> byggs i ett eget arbetsobjekt.`
          }</p>
          <p>${cls ? `Vald klass: <strong>${cls.name}</strong>` : "Ingen klass vald ännu."}</p>
        </div>`;
    },

    async unmount() {
      // Platshållaren har inga timers/lyssnare att städa.
    },
  };
}
