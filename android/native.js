(() => {
  const ordinaryFetch = window.fetch.bind(window);
  if (window === window.top) {
    const pending = new Map(); let sequence = 0;
    window.ew4NativeReply = (id, reply) => { const callback = pending.get(id); if (callback) { pending.delete(id); callback(reply); } };
    window.ew4NativeRequest = (method, path, body) => new Promise(resolve => { const id = String(++sequence); pending.set(id, resolve); ew4Native.request(id, method, path, body || ''); });
    window.ew4FolderPreview = reply => window.dispatchEvent(new CustomEvent('ew4-folder-preview', { detail: reply }));
  }
  window.fetch = async (input, init = {}) => {
    const target = new URL(input instanceof Request ? input.url : input, location.href);
    if (target.origin === location.origin && target.pathname.startsWith('/editor-api/')) {
      const reply = await top.ew4NativeRequest(init.method || 'GET', target.pathname + target.search, init.body);
      const bytes = Uint8Array.from(atob(reply.bytes), c => c.charCodeAt(0));
      return new Response(bytes, { status: reply.status, headers: { 'Content-Type': reply.contentType } });
    }
    return ordinaryFetch(input, init);
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) {
      const name = this.download;
      ordinaryFetch(this.href).then(r => r.blob()).then(blob => new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(blob); }))
        .then(bytes => ew4Native.save(name, bytes));
      return;
    }
    return click.call(this);
  };
})();
