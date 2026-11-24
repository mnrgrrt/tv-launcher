/* Sjuul TV op Android: de motor onder de gedeelde speler (speler.js) is ExoPlayer (Motor.kt).
   Het beeld ligt onder de pagina; deze schil vertaalt de motor-afspraken van speler.js naar het object "Motor".
   MainActivity laadt dit bestand zodra de pagina klaar is. */
(function () {
  'use strict';
  var M = window.Motor, ev = {}, cbs = {}, n = 0;
  if (!M) return;
  window.__motor = function (name) { if (ev[name]) ev[name](); };
  window.__motorCb = function (id, ok, data) { var c = cbs[id]; delete cbs[id]; if (!c) return; if (ok) c.res(data); else c.rej(new Error(data)); };
  window.SpelerMotor = function (root, events) {
    ev = events;
    return {
      transparent: true,
      load: function (src, from, live, audio) {
        return new Promise(function (res, rej) {
          var id = ++n; cbs[id] = { res: res, rej: rej };
          M.load(id, src, +from || 0, !!live, audio == null ? -1 : +audio);
        }).then(function (d) { return +d || 0; });
      },
      time: function () { return M.time(); },
      buffered: function () { return M.buffered(); },
      seek: function (s) { M.seek(+s || 0); return Promise.resolve(); },
      paused: function () { return M.paused(); },
      play: function () { M.play(); }, pause: function () { M.pause(); },
      stop: function () { M.stop(); },
      audio: function () { try { return JSON.parse(M.audio()); } catch (e) { return []; } },
      setAudio: function (i) { M.setAudio(i); return Promise.resolve(); },
      rect: function (r) { if (r) M.rect(r.x, r.y, r.w, r.h, window.innerWidth); else M.rect(0, 0, 0, 0, 0); }
    };
  };
})();
