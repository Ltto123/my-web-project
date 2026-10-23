/** Utopia 工作台：保留原表单节点、草稿与事件，不复制业务状态。 */
(() => {
  const panels = new Map();
  let pendingConfirm = null;
  let lastSession = null;
  const dismiss = overlay => {
    if (overlay.dispatchEvent(new CustomEvent('dialog-dismiss', {cancelable:true}))) overlay.remove();
  };
  function openPanel(section, options = {}) {
    if (typeof section === 'string') section = document.querySelector(section);
    if (!section || section.classList.contains('hidden')) return false;
    if (panels.has(section)) return true;
    const marker = document.createComment('studio-panel-home');
    section.before(marker);
    const overlay = document.createElement('div');
    overlay.className = 'custom-modal-overlay studio-overlay';
    overlay.innerHTML = `<div class="custom-modal-content studio-panel"><header class="studio-panel-head"><span class="studio-eyebrow"></span><button type="button" class="custom-modal-close" aria-label="关闭工作台">×</button><h2></h2><p>留一点想法，让它慢慢生长。</p></header><div class="studio-panel-body"></div></div>`;
    overlay.querySelector('.studio-eyebrow').textContent = options.eyebrow || 'YOUR CREATIVE SPACE';
    overlay.querySelector('h2').textContent = options.title || section.querySelector('h3')?.textContent || '创作工作台';
    if (options.description) overlay.querySelector('.studio-panel-head p').textContent = options.description;
    section.setAttribute('data-studio-panel','');
    overlay.querySelector('.studio-panel-body').append(section);
    const close = () => {
      marker.replaceWith(section);
      panels.delete(section);
      overlay.remove();
      section.dispatchEvent(new CustomEvent('studio-closed'));
    };
    panels.set(section,{overlay,close});
    overlay.addEventListener('dialog-dismiss', event => {event.preventDefault();close();});
    overlay.addEventListener('click', event => {
      if (event.target===overlay || event.target.closest('.custom-modal-close')) dismiss(overlay);
    });
    document.body.append(overlay);
    enhanceFiles(section);
    return true;
  }
  function closePanel(section) {
    if (typeof section==='string') section=document.querySelector(section);
    panels.get(section)?.close();
  }
  function confirmAction({title='确认删除？',message='删除后无法恢复。',confirmText='确认删除',danger=false}={}) {
    // 一次只呈现一个决策，防止连点叠放确认窗口。
    if(pendingConfirm) return Promise.resolve(false);
    return new Promise(resolve=>{
      const overlay=document.createElement('div');
      overlay.className='custom-modal-overlay studio-confirm-overlay';
      overlay.innerHTML='<div class="custom-modal-content studio-confirm"><span class="studio-eyebrow">ONE LAST THOUGHT</span><h2></h2><p></p><div class="studio-confirm-actions"><button type="button" class="studio-secondary" data-cancel>保留内容</button><button type="button" class="studio-primary" data-confirm></button></div></div>';
      overlay.querySelector('h2').textContent=title;
      overlay.querySelector('p').textContent=message;
      const button=overlay.querySelector('[data-confirm]');
      button.textContent=confirmText;
      button.classList.toggle('studio-danger',danger);
      let settled=false;
      const finish=value=>{if(settled)return;settled=true;pendingConfirm=null;overlay.remove();resolve(value);};
      pendingConfirm=()=>finish(false);
      overlay.addEventListener('dialog-dismiss',event=>{event.preventDefault();finish(false);});
      overlay.addEventListener('click',event=>{
        if(event.target===overlay||event.target.closest('[data-cancel]'))finish(false);
        else if(event.target.closest('[data-confirm]'))finish(true);
      });
      document.body.append(overlay);
      // 焦点从安全的取消操作开始；由统一弹层管理器维持循环。
      queueMicrotask(()=>overlay.querySelector('[data-cancel]')?.focus());
    });
  }
  function enhanceFiles(root=document) {
    root.querySelectorAll('input[type="file"]:not([data-studio-file])').forEach(input=>{
      if(input.id==='herb-file'||input.closest('[data-file-custom]'))return;
      input.setAttribute('data-studio-file','');
      const wrapper=document.createElement('div');
      wrapper.className='studio-file';
      input.before(wrapper);
      const label=document.createElement('label');
      label.htmlFor=input.id;
      label.className='studio-file-label';
      label.innerHTML='<span class="studio-file-symbol" aria-hidden="true">↗</span><span><strong>选择文件</strong><small>从你的收藏中，带一份灵感过来。</small></span><span class="studio-file-action">浏览</span>';
      wrapper.append(input,label);
      const update=()=>{
        const files=[...input.files];
        label.querySelector('strong').textContent=files.length?files.map(file=>file.name).join(' · '):'选择文件';
        label.querySelector('small').textContent=files.length?`${files.length} 个文件 · ${(files.reduce((n,file)=>n+file.size,0)/1024/1024).toFixed(2)} MB`:'从你的收藏中，带一份灵感过来。';
        label.querySelector('.studio-file-action').textContent=files.length?'更换':'浏览';
        wrapper.classList.toggle('has-file',files.length>0);
      };
      input.addEventListener('change',update);
      input.form?.addEventListener('reset',()=>setTimeout(update,0));
      update();
    });
  }
  function openGallery(thumb) {
    const images=[...(thumb.closest('.image-grid')?.querySelectorAll('.post-thumb') || [thumb])]
      .map(image=>safeFileUrl(image.dataset.full||image.src)).filter(Boolean);
    if(!images.length)return;
    let index=Math.max(0,images.indexOf(safeFileUrl(thumb.dataset.full||thumb.src)));
    const overlay=document.createElement('div');
    overlay.className='lightbox-overlay studio-gallery';
    overlay.innerHTML='<button type="button" class="custom-modal-close" aria-label="关闭图片">×</button><img class="lightbox-img" alt="手记原图" /><div class="studio-gallery-controls"><button type="button" data-gallery-prev aria-label="上一张图片">←</button><span aria-live="polite"></span><button type="button" data-gallery-next aria-label="下一张图片">→</button></div>';
    const update=()=>{
      overlay.querySelector('img').src=images[index];
      overlay.querySelector('span').textContent=`${String(index+1).padStart(2,'0')} / ${String(images.length).padStart(2,'0')}`;
      overlay.querySelector('[data-gallery-prev]').disabled=index===0;
      overlay.querySelector('[data-gallery-next]').disabled=index===images.length-1;
    };
    const move=direction=>{index=Math.max(0,Math.min(images.length-1,index+direction));update();};
    overlay.addEventListener('click',event=>{
      if(event.target===overlay||event.target.closest('.custom-modal-close'))overlay.remove();
      else if(event.target.closest('[data-gallery-prev]'))move(-1);
      else if(event.target.closest('[data-gallery-next]'))move(1);
    });
    overlay.addEventListener('keydown',event=>{
      if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}
    });
    update();document.body.append(overlay);
  }
  window.GardenUI={openPanel,closePanel,confirm:confirmAction,enhanceFiles,dismiss,openGallery};

  const auth=document.querySelector('.auth-modal-content');
  if(auth) {
    const side=document.createElement('aside');
    side.className='studio-auth-art';
    side.setAttribute('aria-hidden','true');
    side.innerHTML='<span class="studio-eyebrow">A PLACE TO BELONG</span><span class="studio-auth-word">Come<br><em>as you are.</em></span><span class="studio-auth-note">每一个念头，都值得被留下。<br>欢迎来到 Ltto 的私人宇宙。</span>';
    const form=document.createElement('div');
    form.className='studio-auth-form';
    [...auth.children].filter(el=>!el.classList.contains('custom-modal-close')).forEach(el=>form.append(el));
    const heading=document.createElement('div');
    heading.className='studio-auth-heading';
    heading.innerHTML='<span class="studio-eyebrow">YOUR LITTLE CORNER</span><h2 id="auth-heading">好久不见。</h2><p>登录后，接着写下你的故事。</p>';
    form.prepend(heading);
    auth.append(side,form);
    auth.querySelectorAll('input[type=password]').forEach(input=>{
      const wrap=document.createElement('div');wrap.className='studio-password';input.before(wrap);wrap.append(input);
      const button=document.createElement('button');button.type='button';button.textContent='显示';button.className='studio-password-toggle';button.setAttribute('aria-label','显示密码');button.setAttribute('aria-pressed','false');
      button.addEventListener('click',()=>{const show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'隐藏':'显示';button.setAttribute('aria-label',show?'隐藏密码':'显示密码');button.setAttribute('aria-pressed',String(show));});
      wrap.append(button);
    });
  }
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('[data-open-studio]');
    if(trigger) {
      if(trigger.dataset.ownerOnly!==undefined&&!isOwner())return;
      openPanel(trigger.dataset.openStudio,{title:trigger.dataset.studioTitle,eyebrow:trigger.dataset.studioEyebrow});
    }
    if(event.target.closest('[data-comment-login]'))openAuthModal('login');
  });
  const syncAuth=()=>{
    const session = isLoggedIn() ? currentUser.token : null;
    if(lastSession && session!==lastSession) {
      [...panels.keys()].forEach(closePanel);
      pendingConfirm?.();
      document.querySelectorAll('[data-studio-panel]').forEach(section=>section.querySelectorAll('form').forEach(form=>form.reset()));
    }
    lastSession=session;
    document.querySelectorAll('[data-owner-only]').forEach(el=>el.classList.toggle('hidden',!isOwner()));
    document.querySelectorAll('[data-comment-login]').forEach(el=>el.classList.toggle('hidden',isLoggedIn()));
    if(!isLoggedIn()) {
      [...panels.keys()].forEach(closePanel);
      pendingConfirm?.();
    }
  };
  document.addEventListener('auth-changed',syncAuth);
  enhanceFiles();
  syncAuth();
})();
