// Vela 0.9.3: the native canvas routes both plot and axis input through one controller.
export function rectangleHandles({x1, y1, x2, y2}) {
  return [[x1,y1], [x2,y2], [x2,y1], [x1,y2],
    [(x1+x2)/2,y1], [x2,(y1+y2)/2], [(x1+x2)/2,y2], [x1,(y1+y2)/2]];
}

export function resizeRectangle(anchors, handle, point) {
  const timeAnchor = [0,1,1,0,null,1,null,0][handle];
  const priceAnchor = [0,1,0,1,0,null,1,null][handle];
  return anchors.map((anchor, index) => ({
    time: index === timeAnchor ? point.time : anchor.time,
    price: index === priceAnchor ? point.price : anchor.price,
  }));
}

export function installReplayDrawingInteractions(chart, openEditor, host, openMenu) {
  const native = chart.renderer.renderer;
  const layer = native.userDrawings;
  const input = native.input;
  const interaction = layer?.interaction;
  if (!interaction || !input?.deps) return () => {};
  const restore = [];
  function override(target, name, make) {
    const original = target[name];
    const own = Object.hasOwn(target, name);
    target[name] = make(original);
    restore.push(() => { if (own) target[name] = original; else delete target[name]; });
  }

  const onPlot = (x,y) => x >= 0 && x < native.coords.width && y >= 0 &&
    y <= native.coords.height && input.regionAt(x,y) === 'data';
  for (const name of ['drawingsClaim', 'drawingsDblClick', 'drawingsDeleteAt', 'drawingsCursor']) {
    override(input.deps, name, original => (x,y,...args) => onPlot(x,y) && original(x,y,...args) || null);
  }

  const boxes = new WeakSet();
  // Vela replaces drawing instances when the document is committed. Adapt each
  // instance once while retaining its two persisted UTC/price anchors.
  override(layer, 'onScreen', original => function (...args) {
    const drawings = original.apply(this, args);
    for (const box of drawings) {
      if (box.type !== 'box' || boxes.has(box)) continue;
      boxes.add(box);
      const hitTest = box.hitTest;
      box.hitTest = function (x, y, projector, tolerance) {
        const bounds = this.bounds(projector);
        return Boolean(bounds && x >= bounds.x && x <= bounds.x+bounds.w &&
          y >= bounds.y && y <= bounds.y+bounds.h) || hitTest.call(this,x,y,projector,tolerance);
      };
      box.handlePoints = function (projector) {
        const rect = this.rect(projector);
        return rect ? rectangleHandles(rect) : [];
      };
    }
    return drawings;
  });
  override(interaction, 'move', original => function (x,y,mode,shift) {
    const gesture = this.state;
    const box = gesture.kind === 'pressed' && gesture.handle >= 2 ? this.byId(gesture.id) : null;
    if (box?.type !== 'box') return original.call(this,x,y,mode,shift);
    if (box.locked || (!gesture.moved && Math.abs(x-gesture.px)<=3 && Math.abs(y-gesture.py)<=3)) return;
    gesture.moved = true;
    box.anchors = resizeRectangle(gesture.orig, gesture.handle, this.resolve(x,y,box.paneId,mode));
    this.deps.changed();
  });

  // Keep Vela's selection, clipboard and undo paths but suppress its quick popup.
  override(layer, 'openSettingsForSelection', () => () => {});
  override(layer, 'openSettingsById', () => function (id) {
    this.emit({kind:'select', ids:[id]});
  });
  override(layer, 'dblClick', () => function (x,y) {
    if (interaction.finishPlacing(true)) return true;
    const hit = interaction.hitAt(x,y);
    if (!hit) return false;
    this.openSettingsById(hit.id);
    openEditor(hit.id);
    return true;
  });

  if (host && openMenu) {
    const context = event => {
      if (event.target.tagName !== 'CANVAS') return;
      const {x,y}=input.local(event);
      if (!onPlot(x,y)) return;
      const hit=interaction.hitAt(x,y);
      if (!hit) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      layer.openSettingsById(hit.id);
      openMenu({id:hit.id,x:event.clientX,y:event.clientY});
    };
    host.addEventListener('contextmenu',context,true);
    restore.push(()=>host.removeEventListener('contextmenu',context,true));
  }
  return () => restore.reverse().forEach(fn => fn());
}
