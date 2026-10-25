// A sticky graph header with a shared horizontal axis; bands stay in the page flow.
export function createTimelineGraphViewport(scroll, grid, { enablePanning, syncControls }) {
  const axis = grid.querySelector(".timeline-axis-top");
  const graph = grid.querySelector(".timeline-purchase-graph");
  const handle = grid.querySelector(".timeline-current-handle:not(.bottom):not(.interval)");
  const today = grid.querySelector(".timeline-current-label");
  const line = grid.querySelector(".timeline-current-line");
  const dashboardHeader = document.querySelector(".dashboard-header");
  let header = null;
  let headerGrid = null;

  function align() {
    if (!header) return;
    header.style.width = `${scroll.clientWidth}px`;
    header.style.top = `${dashboardHeader?.getBoundingClientRect().height ?? 0}px`;
    if (header.scrollLeft !== scroll.scrollLeft) header.scrollLeft = scroll.scrollLeft;
  }

  function setVisible(visible) {
    if (visible === Boolean(header)) return;
    const left = scroll.scrollLeft;
    if (visible) {
      header = document.createElement("div");
      header.className = "timeline-scroll timeline-graph-header-scroll";
      header.setAttribute("aria-label", "固定された総購入額の推移と日付の目盛り。横にスクロールできます。");
      headerGrid = document.createElement("div");
      headerGrid.className = "timeline-grid timeline-graph-header-grid";
      headerGrid.style.cssText = grid.style.cssText;
      headerGrid.dataset.minYear = grid.dataset.minYear;
      headerGrid.dataset.maxYear = grid.dataset.maxYear;
      headerGrid.append(axis, graph);
      if (line) headerGrid.appendChild(line.cloneNode(true));
      if (handle) headerGrid.appendChild(handle);
      if (today) headerGrid.appendChild(today);
      header.appendChild(headerGrid);
      scroll.before(header);
      scroll.classList.add("timeline-band-scroll");
      grid.classList.add("timeline-band-grid");
      scroll.setAttribute("aria-label", "ライフサイクル帯。上下はページ全体、左右は年表をスクロールできます。");
      enablePanning(header);
      header.addEventListener("scroll", () => {
        if (scroll.scrollLeft !== header.scrollLeft) scroll.scrollLeft = header.scrollLeft;
      }, { passive: true });
      scroll.scrollLeft = left;
      align();
    } else {
      grid.prepend(axis, graph);
      if (handle) grid.appendChild(handle);
      if (today) grid.appendChild(today);
      scroll.classList.remove("timeline-band-scroll");
      grid.classList.remove("timeline-band-grid");
      scroll.setAttribute("aria-label", "ライフサイクル年表。横にスクロールできます。");
      // Move the existing arrow buttons with their handle, without recreating listeners.
      syncControls();
      header.remove();
      header = null;
      headerGrid = null;
      scroll.scrollLeft = left;
    }
    const rows = [...grid.querySelectorAll(".timeline-row")];
    grid.querySelectorAll(".timeline-current-handle.interval").forEach((interval, index) => {
      const row = rows[(index + 1) * 9 - 1];
      if (row) interval.style.top = `${row.offsetTop + row.offsetHeight / 2}px`;
    });
    syncControls();
  }

  scroll.addEventListener("scroll", align, { passive: true });
  window.addEventListener("resize", align);
  const resizeObserver = new ResizeObserver(align);
  resizeObserver.observe(scroll);
  if (dashboardHeader) resizeObserver.observe(dashboardHeader);
  return {
    setVisible,
    destroy() {
      setVisible(false);
      resizeObserver.disconnect();
      scroll.removeEventListener("scroll", align);
      window.removeEventListener("resize", align);
    },
  };
}
