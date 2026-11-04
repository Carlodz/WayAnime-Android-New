/* يظهر الـ splash فوراً ويختفي ملي تتحمّل قائمة «آخر الحلقات» (حدّ أدنى 1.6 ثانية، وأقصى 15 ثانية كاحتياط) */
(function () {
  var t0 = Date.now(), done = false;
  window.waSplashHide = function () {
    if (done) return; done = true;
    var el = document.getElementById('splash'); if (!el) return;
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 800); }, Math.max(0, 1600 - (Date.now() - t0)));
  };
  setTimeout(window.waSplashHide, 15000);
})();
