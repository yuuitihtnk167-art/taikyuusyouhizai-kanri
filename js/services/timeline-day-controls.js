import { dateMonthPosition } from "./monthly-summary.js?v=158";

export function shiftTimelineDay(position, delta, minYear, maxYear) {
  const monthIndex = Math.floor(position);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const days = new Date(year, month + 1, 0).getDate();
  const day = Math.round((position - monthIndex) * days) + 1;
  const shifted = dateMonthPosition(new Date(year, month, day + delta));
  return Math.min(Math.max(shifted, minYear * 12), dateMonthPosition(new Date(maxYear - 1, 11, 31)));
}

export function createDayRepeater(step, timers = globalThis) {
  let timer;
  function stop() { timers.clearTimeout(timer); timer = null; }
  function repeat() {
    if (step() === false) { stop(); return; }
    timer = timers.setTimeout(repeat, 100);
  }
  function start() {
    stop();
    if (step() !== false) timer = timers.setTimeout(repeat, 450);
  }
  return { start, stop };
}

export function createTimelineDayControls(container, move, tooltip) {
  if (!container) return { sync() {} };
  const controls = new WeakMap();
  let pressed = null;
  const repeater = createDayRepeater(() => {
    if (!pressed?.button.isConnected || document.hidden) return false;
    return move(pressed.delta, pressed.handle);
  });

  function stop() {
    repeater.stop();
    if (!pressed) return;
    const { button, pointerId } = pressed;
    pressed = null;
    button.classList.remove("pressed");
    if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    tooltip.hide();
  }

  function sync() {
    container.querySelectorAll(".timeline-current-handle").forEach((handle) => {
      let pair = controls.get(handle);
      if (!pair) {
        pair = [-1, 1].map((delta) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = `timeline-day-step ${delta < 0 ? "previous" : "next"}`;
          button.dataset.action = "step-day";
          button.dataset.delta = String(delta);
          button.setAttribute("aria-label", delta < 0 ? "1日前へ（長押しで連続移動）" : "1日後へ（長押しで連続移動）");
          button.innerHTML = '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M17 3 L5 16 L17 29 L21 25 L13 16 L21 7 Z"/></svg>';
          handle.parentElement.appendChild(button);
          button.markerHandle = handle;
          return button;
        });
        controls.set(handle, pair);
      }
      const y = handle.offsetTop + (handle.classList.contains("interval") ? 0 : handle.offsetHeight / 2);
      pair.forEach((button, index) => {
        if (button.parentElement !== handle.parentElement) handle.parentElement.appendChild(button);
        button.style.left = `calc(${handle.style.left} ${index ? "+" : "-"} var(--day-step-offset))`;
        button.style.top = `${y}px`;
      });
    });
  }

  function arrowFrom(target) {
    return target instanceof Element ? target.closest("[data-action='step-day']") : null;
  }
  container.addEventListener("pointerdown", (event) => {
    const button = arrowFrom(event.target);
    if (!button || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
    pressed = { button, pointerId: event.pointerId, delta: Number(button.dataset.delta), handle: button.markerHandle };
    button.classList.add("pressed");
    button.setPointerCapture(event.pointerId);
    repeater.start();
  });
  container.addEventListener("pointermove", (event) => {
    if (!pressed || event.pointerId !== pressed.pointerId) return;
    // The arrow follows the moving line; keep the initial press captured until release.
    event.preventDefault();
  });
  container.addEventListener("click", (event) => {
    const button = arrowFrom(event.target);
    if (!button) return;
    event.stopPropagation();
    if (event.detail === 0) {
      move(Number(button.dataset.delta), button.markerHandle);
      tooltip.hide();
    }
  });
  container.addEventListener("contextmenu", (event) => {
    if (arrowFrom(event.target)) event.preventDefault();
  });
  const release = (event) => {
    if (pressed && event.pointerId === pressed.pointerId) stop();
  };
  window.addEventListener("pointerup", release);
  window.addEventListener("pointercancel", release);
  container.addEventListener("lostpointercapture", release);
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  return { sync };
}
