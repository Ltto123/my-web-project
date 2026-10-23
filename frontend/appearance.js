/* A visitor's chosen world follows them without replacing the working page. */
(() => {
  if (window.BlogAppearance) return;
  const root = document.documentElement;
  const storageKey = 'blog_appearance';
  const choices = [
    { id: 'art', name: '艺术花园', english: 'THE ORIGINAL', detail: '让灵感，自由生长。', image: 'assets/utopia/botanical.webp' },
    { id: 'spring', name: '春日漫游', english: 'SPRING', detail: '柳梢新绿，花开满途。', image: 'assets/seasons/spring.webp' },
    { id: 'summer', name: '夏日出走', english: 'SUMMER', detail: '海风、旷野和一口冰凉。', image: 'assets/seasons/sea.webp' },
    { id: 'autumn', name: '秋日拾光', english: 'AUTUMN', detail: '红叶落下，桂香经过。', image: 'assets/seasons/autumn.webp' },
    { id: 'winter', name: '冬日围炉', english: 'WINTER', detail: '窗外有雪，手心有暖。', image: 'assets/seasons/winter.webp' },
  ];
  const allowed = new Set(choices.map(choice => choice.id));
  const normalize = value => allowed.has(value) ? value : 'art';
  let current = normalize(root.dataset.appearance);
  let overlay = null;
  let trigger = document.querySelector('#appearance-btn');

  function updateSelection() {
    const chosen = choices.find(choice => choice.id === current);
    trigger?.setAttribute('aria-label', `选择外观，当前为${chosen.name}`);
    overlay?.querySelectorAll('[data-choose-appearance]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.chooseAppearance === current));
    });
    const status = overlay?.querySelector('.appearance-status');
    if (status) status.textContent = `当前外观 · ${chosen.name}`;
  }

  function apply(value, persist = true) {
    current = normalize(value);
    if (persist) safeStorage.setItem(storageKey, current);
    root.dataset.appearance = current;
    updateSelection();
    document.dispatchEvent(new CustomEvent('appearance-changed', { detail: { appearance: current } }));
    return current;
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    trigger?.setAttribute('aria-expanded', 'false');
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function open() {
    if (overlay?.isConnected) return;
    overlay = element('div', 'custom-modal-overlay appearance-overlay');
    overlay.id = 'appearance-modal';
    overlay.restoreFocusTarget = () => trigger;
    const panel = element('section', 'custom-modal-content appearance-panel');
    panel.setAttribute('aria-labelledby', 'appearance-title');
    const header = element('header', 'appearance-heading');
    header.append(element('span', 'appearance-eyebrow', 'A PLACE TO BELONG'));
    const title = element('h2', '', '今天，想住在哪个季节？');
    title.id = 'appearance-title';
    header.append(title, element('p', '', '挑一处喜欢的风景，让它陪你翻过每一页。'));
    const closeButton = element('button', 'custom-modal-close appearance-close', '×');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', '关闭外观选择');
    closeButton.addEventListener('click', close);
    header.append(closeButton);
    const grid = element('div', 'appearance-choices');
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', '博客外观');
    choices.forEach(choice => {
      const button = element('button', `appearance-choice appearance-choice-${choice.id}`);
      button.type = 'button';
      button.dataset.chooseAppearance = choice.id;
      const art = element('span', 'appearance-choice-art');
      art.setAttribute('aria-hidden', 'true');
      const picture = element('img');
      picture.src = choice.image;
      picture.alt = '';
      picture.loading = 'lazy';
      picture.width = 320;
      picture.height = 360;
      picture.addEventListener('error', () => picture.remove(), { once: true });
      art.append(picture, element('span', 'appearance-choice-letter', choice.english));
      const label = element('span', 'appearance-choice-label');
      label.append(element('strong', '', choice.name), element('span', 'appearance-choice-detail', choice.detail));
      const selected = element('span', 'appearance-choice-check', '✓');
      selected.setAttribute('aria-hidden', 'true');
      button.append(art, label, selected);
      button.addEventListener('click', () => apply(choice.id));
      grid.append(button);
    });
    const footer = element('footer', 'appearance-footer');
    const status = element('p', 'appearance-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const done = element('button', 'studio-primary appearance-done', '就在这里，慢慢逛');
    done.type = 'button';
    done.addEventListener('click', close);
    footer.append(status, done);
    panel.append(header, grid, footer);
    overlay.append(panel);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('dialog-dismiss', event => { event.preventDefault(); close(); });
    document.body.append(overlay);
    trigger?.setAttribute('aria-expanded', 'true');
    updateSelection();
  }

  if (!trigger) {
    trigger = element('button', 'toggle-btn appearance-trigger', '外观');
    trigger.id = 'appearance-btn';
    trigger.type = 'button';
    const themeButton = document.querySelector('#theme-btn');
    if (themeButton) themeButton.before(trigger);
    else document.querySelector('.header-actions')?.append(trigger);
  }
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', 'appearance-modal');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', open);
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    safeStorage.sync(storageKey);
    apply(safeStorage.getItem(storageKey), false);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) apply(safeStorage.getItem(storageKey), false);
  });
  window.BlogAppearance = Object.freeze({ apply, open, close, get current() { return current; } });
  apply(safeStorage.getItem(storageKey), false);
})();
