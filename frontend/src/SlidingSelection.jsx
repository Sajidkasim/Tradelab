import React, { useLayoutEffect, useRef } from "react";

const lastSelection = new Map();

function boundsWithin(group, item) {
  if (item.offsetParent === group) {
    return { x: item.offsetLeft, y: item.offsetTop, width: item.offsetWidth, height: item.offsetHeight };
  }
  const rect = item.getBoundingClientRect();
  const parent = group.getBoundingClientRect();
  return {
    x: rect.left - parent.left - group.clientLeft + group.scrollLeft,
    y: rect.top - parent.top - group.clientTop + group.scrollTop,
    width: rect.width,
    height: rect.height,
  };
}

export default function SlidingSelection({
  as: Element = "div", className = "", value, axis = "horizontal",
  itemSelector = ":scope > [data-slide-value]", transitionKey, children, ...props
}) {
  const ref = useRef(null);
  const previous = useRef(null);
  const active = useRef(null);
  const activeValue = useRef(null);

  useLayoutEffect(() => {
    const group = ref.current;
    if (!group) return;
    const items = () => Array.from(group.querySelectorAll(itemSelector));
    const targetFor = (key) => key == null ? null : items().find((item) => item.dataset.slideValue === String(key));
    function place(box, snap) {
      group.toggleAttribute("data-slide-snap", snap);
      group.style.setProperty("--slide-x", `${box.x}px`);
      group.style.setProperty("--slide-y", `${box.y}px`);
      group.style.setProperty("--slide-width", `${box.width}px`);
      group.style.setProperty("--slide-height", `${box.height}px`);
      group.setAttribute("data-slide-ready", "");
    }
    function update() {
      const target = targetFor(value);
      const box = target && boundsWithin(group, target);
      if (active.current !== target) {
        active.current?.removeAttribute("data-slide-selected");
        active.current = target;
        target?.setAttribute("data-slide-selected", "");
      }
      if (!box?.width || !box?.height) {
        previous.current = null;
        group.removeAttribute("data-slide-ready");
        return;
      }
      let prior = previous.current;
      if (!prior && transitionKey) {
        const former = targetFor(lastSelection.get(transitionKey));
        if (former && former !== target) {
          prior = boundsWithin(group, former);
          place(prior, true);
          // Establish the old position when the header remounts during navigation.
          group.firstElementChild.getBoundingClientRect();
        }
      }
      const sameRow = prior && Math.abs(box.y - prior.y) < Math.min(box.height, prior.height) / 2;
      const sameColumn = prior && Math.abs(box.x - prior.x) < Math.min(box.width, prior.width) / 2;
      if (prior && activeValue.current === value && previous.current &&
          Object.keys(box).every((key) => box[key] === prior[key])) return;
      const selectionChanged = activeValue.current !== value;
      const followsAxis = (axis !== "vertical" && sameRow) || (axis !== "horizontal" && sameColumn);
      place(box, !selectionChanged || !followsAxis);
      activeValue.current = value;
      previous.current = box;
      if (transitionKey) lastSelection.set(transitionKey, value);
    }
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(group);
    items().forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, [axis, itemSelector, transitionKey, value]);

  return <Element {...props} className={`sliding-selection ${className}`} ref={ref}>
    <span className="sliding-selection-highlight" aria-hidden="true"/>
    {children}
  </Element>;
}
