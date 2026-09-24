/* Plays the CRT "power-on" boot GIF exactly once, then swaps to the
   static logo and leaves it there. This is deliberately NOT relying on
   the GIF file's own loop-count metadata (loop=0 vs loop=1 behave
   inconsistently enough across browsers that it isn't worth trusting)
  , instead it just measures the animation's real duration once, on
   this page, and swaps the <img> src on a timer. Simple, and correct
   regardless of what any given browser does with GIF looping.

   Used only on pages meant to be seen once per session (login, the
   course home page), never on the 15 content pages, which people
   revisit constantly while studying, where a repeating animation would
   be a genuine distraction rather than a nice touch. */

(function () {
  const BOOT_DURATION_MS = 6300; // measured: 117 frames, ~6.2s, +100ms margin
  document.addEventListener("DOMContentLoaded", () => {
    const img = document.getElementById("boot-logo");
    if (!img) return;
    setTimeout(() => {
      img.src = "/static/branding/logo-static.png";
    }, BOOT_DURATION_MS);
  });
})();
