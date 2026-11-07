/* Arcadia's motion toolkit: one place for every animation helper.
   - motion:           spring physics for gestures and number counters
   - auto-animate:     smooth add/remove in lists (comments, notifications, requests)
   - canvas-confetti:  celebration bursts (level-ups, rewards)
   Everything respects the "reduce motion" setting. */

import { animate } from 'motion';
import autoAnimate from '@formkit/auto-animate';
import confetti from 'canvas-confetti';

export const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

export const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };

/** Smoothly animate list children being added or removed. Returns a controller (enable/disable) or null. */
export function animateList(element, options = {}) {
  if (!element || reduced()) return null;
  try { return autoAnimate(element, { duration: 220, easing: 'ease-out', ...options }); } catch { return null; }
}

/** Run a spring between two numbers, calling onUpdate(value) every frame. Resolves when it settles. */
export function springValue(from, to, onUpdate, { velocity = 0, stiffness = 420, damping = 38 } = {}) {
  if (reduced() || from === to) { onUpdate(to); return Promise.resolve(); }
  try {
    const controls = animate(from, to, { type: 'spring', stiffness, damping, velocity, onUpdate });
    return Promise.resolve(controls?.finished ?? controls).catch(() => {});
  } catch { onUpdate(to); return Promise.resolve(); }
}

/** Count a number up (or down) inside a node. */
export function countUp(node, from, to, { duration = 0.9, format = (value) => String(Math.round(value)) } = {}) {
  if (!node) return;
  if (reduced() || from === to) { node.textContent = format(to); return; }
  try { animate(from, to, { duration, ease: 'easeOut', onUpdate: (value) => { node.textContent = format(value); } }); }
  catch { node.textContent = format(to); }
}

const BRAND = ['#7c5cff', '#2dd4bf', '#ffb454', '#ffffff'];

/** A short burst of confetti. `big` is for level-ups. */
export function celebrate({ big = false, origin = { x: 0.5, y: 0.35 } } = {}) {
  if (reduced()) return;
  try {
    confetti({ particleCount: big ? 140 : 50, spread: big ? 90 : 60, startVelocity: big ? 42 : 32, origin, colors: BRAND, ticks: 180, disableForReducedMotion: true, zIndex: 100000 });
    if (big) window.setTimeout(() => confetti({ particleCount: 70, spread: 120, origin, colors: BRAND, ticks: 160, zIndex: 100000 }), 200);
  } catch { /* confetti is a bonus, never essential */ }
}

/** Replay a CSS animation class once (for pop effects). */
export function pop(element, className = 'is-pop', ms = 500) {
  if (!element) return;
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), ms);
}
