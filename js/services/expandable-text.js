function isOverflowing(text) {
  return text.scrollWidth > text.clientWidth || text.scrollHeight > text.clientHeight;
}

export function enhanceExpandableTextarea(textarea) {
  textarea.classList.add("expandable-text-field");

  let expanded = false;
  function resize() {
    if (!expanded) return;
    const scrollTop = textarea.scrollTop;
    textarea.style.height = "";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
    textarea.scrollTop = scrollTop;
  }

  function setExpanded(next) {
    if (expanded === next) return;
    expanded = next;
    textarea.classList.toggle("is-expanded", expanded);
    if (expanded) {
      resize();
    } else {
      textarea.style.height = "";
      textarea.scrollTop = 0;
      textarea.scrollLeft = 0;
    }
  }

  function expandIfNeeded() {
    if (!expanded && isOverflowing(textarea)) setExpanded(true);
  }

  textarea.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !expanded && isOverflowing(textarea)) {
      event.preventDefault();
    }
  });
  textarea.addEventListener("click", expandIfNeeded);
  textarea.addEventListener("focus", expandIfNeeded);
  textarea.addEventListener("input", () => {
    if (expanded) resize();
    else expandIfNeeded();
  });
  document.addEventListener("click", (event) => {
    if (!expanded || event.target === textarea) return;
    if (Array.from(textarea.labels).some((label) => label.contains(event.target))) return;
    setExpanded(false);
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setExpanded(false);
  });

  let width;
  new ResizeObserver(([entry]) => {
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    resize();
  }).observe(textarea);
  return () => setExpanded(false);
}

let closeOpenPreview;

export function createExpandableText(value) {
  const element = document.createElement("span");
  element.className = "expandable-text-preview";
  element.textContent = value;

  let expanded = false;
  function refresh() {
    const canExpand = expanded || isOverflowing(element);
    if (canExpand) {
      element.setAttribute("role", "button");
      element.setAttribute("aria-expanded", String(expanded));
      element.tabIndex = 0;
    } else {
      element.removeAttribute("role");
      element.removeAttribute("aria-expanded");
      element.removeAttribute("tabindex");
    }
  }

  function closeOnOutsideClick(event) {
    if (!element.contains(event.target)) close();
  }

  function close() {
    expanded = false;
    element.classList.remove("is-expanded");
    element.scrollTop = 0;
    element.scrollLeft = 0;
    document.removeEventListener("click", closeOnOutsideClick);
    closeOpenPreview = undefined;
    refresh();
  }

  function open() {
    if (expanded || !isOverflowing(element)) return;
    closeOpenPreview?.();
    expanded = true;
    element.classList.add("is-expanded");
    closeOpenPreview = close;
    document.addEventListener("click", closeOnOutsideClick);
    refresh();
  }

  element.addEventListener("click", open);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && expanded) close();
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return { element, refresh };
}
