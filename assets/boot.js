// Runs in <head>, before the first paint. Sets the entrance start state when
// motion is allowed; a safety timer removes it even if roamid.js never runs.
(function () {
  var d = document.documentElement;
  if (!d.hasAttribute("data-anim")) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  d.classList.add("enter");
  setTimeout(function () { d.classList.remove("enter"); }, 2600);
})();
