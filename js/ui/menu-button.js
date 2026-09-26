/**
 * MENYKNAPP — en tillgänglig rullgardin (issue #45).
 *
 * Knapp med aria-haspopup="menu" + aria-expanded som öppnar en lista
 * med role="menu" och role="menuitem" (vanliga <a href> — navigeringen
 * sköts av länken själv). Mönstret följer WAI-ARIA "Menu Button":
 *
 *   På knappen:  Enter / Mellanslag / ↓  öppna, fokus på aktivt (annars första) val
 *                ↑                       öppna, fokus på sista valet
 *   I menyn:     ↓ ↑ (runt), Home / End  flytta fokus
 *                Enter / Mellanslag      välj
 *                Esc                     stäng, fokus tillbaka till knappen
 *                Tab                     stäng (fokus går vidare)
 *   Klick utanför, eller fokus som lämnar menyn, stänger den.
 *
 * Val med attributet hidden hoppas över (så kan samma lista användas
 * för "Mer ▾", där bara de lägen som inte ryms i raden visas).
 */

export function createMenuButton({ root, button, menu }) {
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  const items = () =>
    [...menu.querySelectorAll('[role="menuitem"]')].filter((i) => !i.hidden);

  const isOpen = () => button.getAttribute("aria-expanded") === "true";

  function focusItem(which) {
    const list = items();
    if (list.length === 0) return;
    const cur = list.indexOf(document.activeElement);
    let i;
    if (which === "first") i = 0;
    else if (which === "last") i = list.length - 1;
    else if (which === "current") i = Math.max(0, list.findIndex((el) => el.getAttribute("aria-current") === "page"));
    else i = (cur + which + list.length) % list.length; // +1 / -1, runt
    list[i].focus();
  }

  function onOutside(e) {
    if (!root.contains(e.target)) close();
  }

  function open(focus = null) {
    if (!isOpen()) {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      root.dataset.open = "true";
      document.addEventListener("pointerdown", onOutside, true);
    }
    if (focus) focusItem(focus);
  }

  function close({ restoreFocus = false } = {}) {
    if (!isOpen()) return;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    delete root.dataset.open;
    document.removeEventListener("pointerdown", onOutside, true);
    if (restoreFocus) button.focus();
  }

  button.addEventListener("click", () => (isOpen() ? close() : open()));

  button.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open("current"); // det aktiva valet, annars det första
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      open("last");
    } else if (e.key === "Escape" && isOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  menu.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); focusItem(1); break;
      case "ArrowUp": e.preventDefault(); focusItem(-1); break;
      case "Home": e.preventDefault(); focusItem("first"); break;
      case "End": e.preventDefault(); focusItem("last"); break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close({ restoreFocus: true });
        break;
      case " ":
        if (e.target.matches('[role="menuitem"]')) { e.preventDefault(); e.target.click(); }
        break;
      case "Tab": close(); break;
      default: break;
    }
  });

  // Ett val → stäng (länken navigerar själv). Fokus till knappen, så att
  // tangentbordsanvändaren står kvar i menyn efter bytet.
  menu.addEventListener("click", (e) => {
    if (e.target.closest('[role="menuitem"]')) close({ restoreFocus: true });
  });

  // Fokus som lämnar hela komponenten (t.ex. Shift+Tab) stänger menyn.
  root.addEventListener("focusout", (e) => {
    if (isOpen() && e.relatedTarget && !root.contains(e.relatedTarget)) close();
  });

  return { open, close, isOpen };
}
