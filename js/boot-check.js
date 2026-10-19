// Plain (non-module) script. If the page's main JavaScript fails to load
// (a typo in firebase-config.js, a missing file, opening the page by
// double-clicking instead of Live Server...), show a clear message instead
// of a page whose buttons silently do nothing.
(function () {
  function show(msg) {
    if (window.__appLoaded || document.getElementById("boot-error")) return;
    var b = document.createElement("div");
    b.id = "boot-error";
    b.className = "config-banner";
    b.style.background = "#fdecea"; b.style.color = "#8a1f11"; b.style.borderColor = "#f2d0cb";
    b.innerHTML = "<strong>The website's code did not load, so buttons will not work.</strong> " + msg;
    document.body.prepend(b);
  }
  if (location.protocol === "file:") {
    document.addEventListener("DOMContentLoaded", function () {
      show("You opened this file directly. Open it with VS Code <strong>Live Server</strong> (right-click index.html &rarr; Open with Live Server) or from your GitHub Pages link.");
    });
    return;
  }
  window.addEventListener("load", function () {
    setTimeout(function () {
      show("Most likely cause: <code>js/firebase-config.js</code> must start with <code>export const firebaseConfig = {</code> " +
        "(paste only the values, not the whole Firebase snippet), or a file is missing (e.g. <code>js/site-config.js</code>). " +
        "Press F12 &rarr; Console to see the exact error.");
    }, 2500);
  });
  // Stop forms from reloading the page (and putting the password in the address bar) if the code is missing.
  document.addEventListener("submit", function (e) { if (!window.__appLoaded) e.preventDefault(); }, true);
})();
