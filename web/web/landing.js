// Sem inline (CSP estrita do site). Só avisa quem está no iPhone.
(function () {
  var ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/i.test(ua)) {
    var n = document.getElementById("ios");
    if (n) n.hidden = false;
    var b = document.getElementById("dl");
    if (b) { b.removeAttribute("download"); b.setAttribute("href", "jogar.html"); b.lastChild.textContent = " Jogar no navegador"; }
  }
})();
