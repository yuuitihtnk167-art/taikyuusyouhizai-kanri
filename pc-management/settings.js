import "./pwa.js";

// Keep the old URL working for bookmarks and cached links.
window.location.replace(new URL("../settings.html?from=pc", import.meta.url).href);
