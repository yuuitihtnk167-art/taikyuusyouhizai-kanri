export function timelineMarkerDateLabel(position) {
  const monthIndex = Math.floor(position);
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const days = new Date(year, month + 1, 0).getDate();
  const day = Math.round((position - monthIndex) * days) + 1;
  return `${month + 1}/${day}`;
}

export function createTimelineMarkerTooltip(container, getPosition, isDragging) {
  if (!container) return { show() {}, update() {}, hide() {} };
  const tooltip = document.createElement("div");
  tooltip.id = "timeline-marker-date-tooltip";
  tooltip.className = "timeline-marker-date-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.appendChild(tooltip);
  let activeHandle = null;
  let hideTimer;

  function hideNow() {
    tooltip.hidden = true;
    activeHandle?.removeAttribute("aria-describedby");
    activeHandle = null;
  }

  function update() {
    if (tooltip.hidden) return;
    if (!activeHandle?.isConnected) {
      hideNow();
      return;
    }
    tooltip.textContent = timelineMarkerDateLabel(getPosition());
    const rect = activeHandle.getBoundingClientRect();
    const halfWidth = tooltip.offsetWidth / 2;
    const x = Math.min(Math.max(rect.left + rect.width / 2, halfWidth + 4), document.documentElement.clientWidth - halfWidth - 4);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${Math.max(4, rect.top - tooltip.offsetHeight - 8)}px`;
  }

  function show(handle) {
    window.clearTimeout(hideTimer);
    activeHandle?.removeAttribute("aria-describedby");
    activeHandle = handle;
    activeHandle.setAttribute("aria-describedby", tooltip.id);
    tooltip.hidden = false;
    update();
  }

  function hide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideNow, 1000);
  }

  function handleFrom(target) {
    return target instanceof Element ? target.closest("[data-action='drag-current-line']") : null;
  }

  container.addEventListener("pointerover", (event) => {
    const handle = handleFrom(event.target);
    if (event.pointerType === "mouse" && handle) show(handle);
  });
  container.addEventListener("pointerout", (event) => {
    const handle = handleFrom(event.target);
    if (handle && !handle.contains(event.relatedTarget) && !isDragging()) hide();
  });
  container.addEventListener("focusin", (event) => {
    const handle = handleFrom(event.target);
    if (handle) show(handle);
  });
  container.addEventListener("focusout", (event) => {
    if (handleFrom(event.target) && !isDragging()) hide();
  });
  window.addEventListener("scroll", update, true);
  window.addEventListener("resize", update);
  return { show, update, hide };
}
