// Positions use the same calendar-day/month scale as the lifecycle bands.
export function nextDayPosition(position) {
  const month = Math.floor(position);
  const year = Math.floor(month / 12);
  const monthOfYear = month - year * 12;
  const days = new Date(year, monthOfYear + 1, 0).getDate();
  const date = new Date(year, monthOfYear, Math.floor((position - month) * days + 1e-8) + 2);
  const nextDays = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getFullYear() * 12 + date.getMonth() + (date.getDate() - 1) / nextDays;
}

// End dates are inclusive, exactly as in the existing summary calculation.
export function purchaseTotalSeries(intervals, minPosition, maxPosition) {
  const changes = new Map();
  let total = 0;
  for (const { start, end, amount } of intervals) {
    if (![start, end, amount].every(Number.isFinite) || end < start) continue;
    const afterEnd = nextDayPosition(end);
    if (start <= minPosition && minPosition < afterEnd) total += amount;
    for (const [position, delta] of [[start, amount], [afterEnd, -amount]]) {
      if (position > minPosition && position <= maxPosition) {
        changes.set(position, (changes.get(position) || 0) + delta);
      }
    }
  }
  const points = [{ position: minPosition, total }];
  for (const [position, delta] of [...changes].sort(([a], [b]) => a - b)) {
    if (delta === 0) continue;
    total += delta;
    points.push({ position, total });
  }
  if (points.at(-1).position < maxPosition) points.push({ position: maxPosition, total });
  return points;
}

const SVG_NS = "http://www.w3.org/2000/svg";
function svgElement(tag, attributes = {}, text = "") {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  element.textContent = text;
  return element;
}

export function mountPurchaseGraph(grid, { intervals, minYear, maxYear, labelWidth, yearWidth, compact, visible }) {
  const points = purchaseTotalSeries(intervals, minYear * 12, maxYear * 12);
  const width = (maxYear - minYear) * yearWidth;
  const height = compact ? 192 : 252;
  const top = 34;
  const bottom = height - 18;
  const peak = Math.max(1, ...points.map((point) => point.total));
  const unit = 10 ** Math.floor(Math.log10(peak));
  const ceiling = Math.max(2, Math.ceil(peak / unit) * unit);
  const x = (position) => (position - minYear * 12) / 12 * yearWidth;
  const y = (total) => bottom - total / ceiling * (bottom - top);
  const row = document.createElement("section");
  row.id = "timeline-purchase-graph";
  row.className = "timeline-purchase-graph";
  row.setAttribute("aria-label", "総購入額の推移。帯グラフと共通の日付軸・横スクロールです。");
  row.style.height = `${height}px`;
  const label = document.createElement("div");
  label.className = "timeline-purchase-graph-label";
  const heading = document.createElement("strong");
  heading.textContent = "総購入額";
  label.appendChild(heading);
  const svg = svgElement("svg", { width, height, viewBox: `0 0 ${width} ${height}`, role: "img" });
  svg.style.left = `${labelWidth}px`;
  svg.appendChild(svgElement("title", {}, "日付ごとの総購入額。選択日の金額は上部の総購入額に表示します。"));
  for (const total of [ceiling, ceiling / 2, 0]) {
    const tick = document.createElement("span");
    tick.className = "timeline-purchase-graph-value";
    tick.style.top = `${y(total)}px`;
    tick.textContent = `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(total)}円`;
    label.appendChild(tick);
    svg.appendChild(svgElement("line", { x1: 0, x2: width, y1: y(total), y2: y(total), class: "purchase-graph-guide" }));
  }
  let path = `M${x(points[0].position)},${y(points[0].total)}`;
  for (const point of points.slice(1)) path += `H${x(point.position)}V${y(point.total)}`;
  svg.appendChild(svgElement("path", { d: path, class: "purchase-graph-path" }));
  const dot = svgElement("circle", { r: compact ? 3 : 4, class: "purchase-graph-dot" });
  svg.appendChild(dot);
  row.append(label, svg);
  // Keep the graph inside the existing grid, so bands, line and graph scroll together.
  grid.appendChild(row);
  function setVisible(value) { row.hidden = !value; }
  setVisible(visible);
  return {
    setVisible,
    update(position, total) {
      dot.setAttribute("cx", x(position));
      dot.setAttribute("cy", y(total));
      dot.setAttribute("visibility", position < minYear * 12 || position > maxYear * 12 ? "hidden" : "visible");
    },
  };
}
