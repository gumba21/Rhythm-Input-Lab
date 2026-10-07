"use strict";

(() => {
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const runtime = {
    installed: false,
    active: false,
    previousFocus: null,
    bodyOverflow: "",
    htmlOverflow: "",
    appHadInert: false,
    appAriaHidden: null,
    mainScrollTop: 0,
    mainScrollLeft: 0,
  };

  function focusable(modal) {
    return qa('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])', modal)
      .filter(node => node.getClientRects().length > 0 && node.getAttribute("aria-hidden") !== "true");
  }

  function focusPicker(modal) {
    const target = q("#songPickerSearch", modal) || focusable(modal)[0];
    target?.focus?.({ preventScroll: true });
  }

  function enterModal(modal) {
    if (runtime.active) return;
    runtime.active = true;
    runtime.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    runtime.bodyOverflow = document.body.style.overflow;
    runtime.htmlOverflow = document.documentElement.style.overflow;

    const appShell = q(".app-shell");
    const main = q(".main");
    runtime.appHadInert = Boolean(appShell?.hasAttribute("inert"));
    runtime.appAriaHidden = appShell?.getAttribute("aria-hidden") ?? null;
    runtime.mainScrollTop = Number(main?.scrollTop || 0);
    runtime.mainScrollLeft = Number(main?.scrollLeft || 0);

    modal.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    focusPicker(modal);

    if (appShell) {
      appShell.setAttribute("inert", "");
      appShell.setAttribute("aria-hidden", "true");
    }
  }

  function leaveModal(modal) {
    modal.setAttribute("aria-hidden", "true");
    if (!runtime.active) return;
    runtime.active = false;

    document.documentElement.style.overflow = runtime.htmlOverflow;
    document.body.style.overflow = runtime.bodyOverflow;

    const appShell = q(".app-shell");
    if (appShell) {
      if (!runtime.appHadInert) appShell.removeAttribute("inert");
      if (runtime.appAriaHidden === null) appShell.removeAttribute("aria-hidden");
      else appShell.setAttribute("aria-hidden", runtime.appAriaHidden);
    }

    const main = q(".main");
    if (main) {
      main.scrollTop = runtime.mainScrollTop;
      main.scrollLeft = runtime.mainScrollLeft;
    }

    const previous = runtime.previousFocus;
    runtime.previousFocus = null;
    requestAnimationFrame(() => {
      if (previous?.isConnected && !previous.closest?.("[inert]")) previous.focus?.({ preventScroll: true });
    });
  }

  function trapKeyboard(event, modal) {
    if (!runtime.active) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      modal.classList.remove("open");
      return;
    }
    if (event.key !== "Tab") return;

    const rows = focusable(modal);
    if (!rows.length) {
      event.preventDefault();
      modal.focus?.({ preventScroll: true });
      return;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function install() {
    if (runtime.installed) return true;
    const modal = q("#songPickerModal");
    if (!modal) return false;
    runtime.installed = true;

    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Choose a song");
    modal.setAttribute("aria-hidden", modal.classList.contains("open") ? "false" : "true");
    modal.tabIndex = -1;
    modal.addEventListener("keydown", event => trapKeyboard(event, modal), true);

    document.addEventListener("focusin", event => {
      if (!runtime.active || modal.contains(event.target)) return;
      event.stopPropagation();
      focusPicker(modal);
    }, true);

    const sync = () => {
      if (modal.classList.contains("open")) enterModal(modal);
      else leaveModal(modal);
    };
    new MutationObserver(sync).observe(modal, { attributes: true, attributeFilter: ["class"] });
    sync();
    return true;
  }

  const timer = setInterval(() => { if (install()) clearInterval(timer); }, 50);
  setTimeout(install, 0);
  window.rilSongPickerModal = { install, diagnostics: runtime };
})();
