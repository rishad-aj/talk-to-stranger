
  // Keep blob URLs alive: revoking a module-worker blob URL immediately can
  // kill the worker in some browsers before its imports finish loading
  // (this breaks the server-plugin emulator here). Blob URLs are tiny and are
  // freed automatically when the page unloads, so skipping revocation is safe.
  URL.revokeObjectURL = function () {};
  // Pin the viewport so mobile browsers don't zoom the app (perchance wraps
  // index.html in a <body>, so the meta tag has to be injected at runtime).
  (function () {
    for (const old of document.querySelectorAll("meta[name=viewport]")) old.remove();
    const m = document.createElement("meta");
    m.name = "viewport";
    m.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no";
    document.head.appendChild(m);

    const manifestUrl = "https://user.uploads.dev/file/25455502383c588f70e0be7cce93247d.json";
    const iconUrl = "https://user.uploads.dev/file/b6802c73e0b623361cc1949c6b29a267.png";
    const gsv = document.createElement("meta");
    gsv.name = "google-site-verification";
    gsv.content = "U3t9wA4vjKh7lfucph42UiArBP08K5et-VoqeKNvFfA";
    document.head.appendChild(gsv);
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = manifestUrl;
    document.head.appendChild(link);
    const tc = document.createElement("meta");
    tc.name = "theme-color";
    tc.content = "#2563eb";
    document.head.appendChild(tc);
    const ai = document.createElement("link");
    ai.rel = "apple-touch-icon";
    ai.href = iconUrl;
    document.head.appendChild(ai);
    const mc = document.createElement("meta");
    mc.name = "apple-mobile-web-app-capable";
    mc.content = "yes";
    document.head.appendChild(mc);
    const ms = document.createElement("meta");
    ms.name = "apple-mobile-web-app-status-bar-style";
    ms.content = "default";
    document.head.appendChild(ms);
    const mt = document.createElement("meta");
    mt.name = "apple-mobile-web-app-title";
    mt.content = "Chat Room";
    document.head.appendChild(mt);
  })();
