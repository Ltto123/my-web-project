/* Apply saved appearance before styles and page content are painted. */
(() => {
  const root = document.documentElement;
  const allowed = ['art', 'spring', 'summer', 'autumn', 'winter'];
  let appearance = 'art';
  let tone = 'dark';
  try {
    const saved = window.localStorage.getItem('blog_appearance');
    if (allowed.includes(saved)) appearance = saved;
    tone = window.localStorage.getItem('dark_mode_active') === 'false' ? 'light' : 'dark';
  } catch { /* Storage can be unavailable in private windows. */ }
  root.dataset.appearance = appearance;
  root.dataset.tone = tone;
  root.style.colorScheme = tone;
})();
