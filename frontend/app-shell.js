/** 跨页过渡、请求反馈与弹窗键盘行为；不接管浏览器路由。 */
(() => {
  document.querySelectorAll("link[data-optional-fonts]").forEach(link => {
    if (link.sheet) link.media = "all";
    else link.addEventListener("load", () => { link.media = "all"; }, { once: true });
  });
  const indicator = document.createElement("div");
  indicator.className = "page-load-indicator";
  indicator.setAttribute("aria-hidden", "true");
  document.body.append(indicator);
  let requests = 0;
  let navigation = false;
  let delay;
  const updateIndicator = () => {
    clearTimeout(delay);
    if (requests || navigation) {
      delay = setTimeout(() => indicator.classList.add("is-loading"), 120);
    } else {
      indicator.classList.remove("is-loading");
    }
  };
  document.addEventListener("request-start", () => { requests++; updateIndicator(); });
  document.addEventListener("request-end", () => { requests = Math.max(0, requests - 1); updateIndicator(); });
  document.addEventListener("click", event => {
    const link = event.target.closest("a[href]");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    navigation = true;
    updateIndicator();
    // 保留原生导航、返回与表单行为。取消离开后也能消除提示。
    setTimeout(() => { navigation = false; updateIndicator(); }, 8000);
  });
  window.addEventListener("pageshow", event => {
    requests = 0;
    navigation = false;
    updateIndicator();
    if (event.persisted) { loadUserSession(); updateAuthUI(); }
  });

  const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]';
  let dialogs = [];
  const openers = new WeakMap();
  const backgroundState = new Map();
  const visible = element => !element.closest(".hidden") && element.getClientRects().length > 0;
  function syncDialogs() {
    const found = [...document.querySelectorAll("body > .auth-modal-overlay, body > .custom-modal-overlay, body > .lightbox-overlay")].filter(visible);
    const next = [...dialogs.filter(dialog => found.includes(dialog)), ...found.filter(dialog => !dialogs.includes(dialog))];
    for (const overlay of next) {
      if (dialogs.includes(overlay)) continue;
      openers.set(overlay, document.activeElement);
      const panel = overlay.querySelector(".auth-modal-content, .custom-modal-content") || overlay;
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", overlay.id === "auth-modal" ? "登录或注册" : panel.querySelector("h1, h2")?.textContent || "内容详情");
      panel.tabIndex = -1;
      overlay.querySelectorAll(".custom-modal-close").forEach(close => {
        close.setAttribute("aria-label", "关闭窗口");
        if (close.tagName !== "BUTTON") { close.setAttribute("role", "button"); close.tabIndex = 0; }
      });
      ([...panel.querySelectorAll("input:not([type=hidden])")].find(visible) || panel).focus({ preventScroll: true });
    }
    const removed = dialogs.filter(dialog => !next.includes(dialog));
    dialogs = next;
    dialogs.forEach((overlay, index) => {
      overlay.style.zIndex = `calc(var(--z-modal) + ${index})`;
      overlay.inert = index !== dialogs.length - 1;
    });
    removed.forEach(overlay => { overlay.inert = false; });
    if (dialogs.length) {
      document.querySelectorAll("body > header, body > main, body > footer").forEach(element => {
        if (!backgroundState.has(element)) backgroundState.set(element, element.inert);
        element.inert = true;
      });
    } else {
      backgroundState.forEach((wasInert, element) => { element.inert = wasInert; });
      backgroundState.clear();
    }
    document.body.classList.toggle("dialog-open", dialogs.length > 0);
    const previous = removed.at(-1);
    const opener = previous && (previous.restoreFocusTarget?.() || openers.get(previous));
    if (opener?.isConnected && !opener.closest("[inert]")) opener.focus({ preventScroll: true });
  }
  const observer = new MutationObserver(syncDialogs);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", event => {
    const overlay = dialogs.at(-1);
    if (!overlay) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (overlay.id === "auth-modal") closeAuthModal();
      else if (overlay.dispatchEvent(new CustomEvent('dialog-dismiss', { cancelable: true }))) overlay.remove();
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches('.custom-modal-close[role="button"]')) {
      event.preventDefault(); event.target.click(); return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...overlay.querySelectorAll(focusableSelector)].filter(visible);
    if (!focusable.length) { event.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !focusable.includes(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  });
  document.addEventListener("auth-changed", () => {
    document.querySelectorAll(".custom-modal-overlay .comment-form, .custom-modal-overlay .comment-form2").forEach(form => {
      form.querySelectorAll("textarea, button[type=submit]").forEach(element => { element.disabled = !isLoggedIn() || (element.tagName === "BUTTON" && form.dataset.submitting === "true"); });
      const textarea = form.querySelector("textarea");
      if (textarea) textarea.placeholder = isLoggedIn() ? "写下你的评论..." : "登录后可评论";
    });
  });
})();
