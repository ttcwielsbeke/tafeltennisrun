// input.js - toetsenbord en swipes omzetten naar spelacties.
// createInput(target, onAction) -> { destroy() }
// Acties: 'left' | 'right' | 'jump' | 'slide' | 'pause'
(function (root) {
  'use strict';

  var KEY_ACTIONS = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'jump', KeyW: 'jump', Space: 'jump',
    ArrowDown: 'slide', KeyS: 'slide',
    KeyP: 'pause', Escape: 'pause'
  };
  // Terugval op e.key als e.code ontbreekt
  var KEY_FALLBACK = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', w: 'jump', W: 'jump', ' ': 'jump',
    ArrowDown: 'slide', s: 'slide', S: 'slide',
    p: 'pause', P: 'pause', Escape: 'pause'
  };

  var TAP_MAX_MS = 250;

  function now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  // Drempel in CSS-px: minstens 28, iets groter op grote schermen, max 60
  function swipeThreshold() {
    var w = typeof root.innerWidth === 'number' ? root.innerWidth : 0;
    var h = typeof root.innerHeight === 'number' ? root.innerHeight : 0;
    var m = Math.min(w || h, h || w);
    return Math.min(60, Math.max(28, 0.06 * m));
  }

  // Typen in een invoerveld mag het spel niet storen
  function isEditable(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!t.isContentEditable;
  }

  function createInput(target, onAction) {
    var fire = typeof onAction === 'function' ? onAction : function () {};
    var gesture = null; // { id, x, y, t, type, done }

    function onKeyDown(e) {
      if (e.repeat) return;
      if (isEditable(e.target)) return;
      var action = (e.code && KEY_ACTIONS[e.code]) || KEY_FALLBACK[e.key];
      if (!action) return;
      if (e.preventDefault) e.preventDefault();
      fire(action);
    }

    // Knoppen en UI-elementen bovenop het canvas negeren
    function isUi(e) {
      var el = e.target;
      return !!(el && el.closest && el.closest('button, [data-ui], input, a'));
    }

    function onDown(e) {
      if (e.isPrimary === false) return;
      if (isUi(e)) { gesture = null; return; }
      gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), type: e.pointerType, done: false };
    }

    function onMove(e) {
      var g = gesture;
      if (!g || g.done || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x;
      var dy = e.clientY - g.y;
      var th = swipeThreshold();
      if (Math.abs(dx) < th && Math.abs(dy) < th) return;
      g.done = true; // één actie per gebaar
      if (Math.abs(dx) >= Math.abs(dy)) fire(dx < 0 ? 'left' : 'right');
      else fire(dy < 0 ? 'jump' : 'slide');
    }

    function onUp(e) {
      var g = gesture;
      if (!g || e.pointerId !== g.id) return;
      gesture = null;
      if (g.done) return;
      var dx = e.clientX - g.x;
      var dy = e.clientY - g.y;
      var th = swipeThreshold();
      if (now() - g.t < TAP_MAX_MS && Math.abs(dx) < th && Math.abs(dy) < th) fire('jump');
    }

    function onCancel(e) {
      if (gesture && e.pointerId === gesture.id) gesture = null;
    }

    if (target && target.style) target.style.touchAction = 'none';

    root.addEventListener('keydown', onKeyDown);
    target.addEventListener('pointerdown', onDown);
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onCancel);

    return {
      destroy: function () {
        root.removeEventListener('keydown', onKeyDown);
        target.removeEventListener('pointerdown', onDown);
        target.removeEventListener('pointermove', onMove);
        target.removeEventListener('pointerup', onUp);
        target.removeEventListener('pointercancel', onCancel);
        gesture = null;
      }
    };
  }

  root.TTR = root.TTR || {};
  root.TTR.createInput = createInput;
  if (typeof module !== 'undefined' && module.exports) module.exports = { createInput: createInput };
})(typeof globalThis !== 'undefined' ? globalThis : this);
