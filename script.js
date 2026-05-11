const SVG_NS = "http://www.w3.org/2000/svg";
const ANGLE_SNAP_THRESHOLD = 0.1;
const LABEL_MEASURE_CANVAS = document.createElement("canvas");
const LABEL_MEASURE_CONTEXT = LABEL_MEASURE_CANVAS.getContext("2d");

const state = {
  image: {
    element: null,
    src: "",
    name: "",
    naturalWidth: 0,
    naturalHeight: 0
  },
  annotations: [],
  selectedId: null,
  editingId: null,
  mode: "idle",
  draftAnnotationId: null,
  dragTarget: null,
  pointer: null,
  angleGuide: null,
  undoStack: [],
  redoStack: []
};

const dom = {
  imageInput: document.getElementById("imageInput"),
  deleteLineButton: document.getElementById("deleteLineButton"),
  duplicateLineButton: document.getElementById("duplicateLineButton"),
  exportButton: document.getElementById("exportButton"),
  exportFormatInput: document.getElementById("exportFormatInput"),
  annotationList: document.getElementById("annotationList"),
  labelInput: document.getElementById("labelInput"),
  colorInput: document.getElementById("colorInput"),
  textColorInput: document.getElementById("textColorInput"),
  styleInput: document.getElementById("styleInput"),
  labelPositionInput: document.getElementById("labelPositionInput"),
  arrowStyleInput: document.getElementById("arrowStyleInput"),
  arrowAngleInput: document.getElementById("arrowAngleInput"),
  lineWidthInput: document.getElementById("lineWidthInput"),
  lineWidthValue: document.getElementById("lineWidthValue"),
  dashGapInput: document.getElementById("dashGapInput"),
  dashGapValue: document.getElementById("dashGapValue"),
  fontSizeInput: document.getElementById("fontSizeInput"),
  fontSizeValue: document.getElementById("fontSizeValue"),
  fontFamilyInput: document.getElementById("fontFamilyInput"),
  arrowSizeInput: document.getElementById("arrowSizeInput"),
  arrowSizeValue: document.getElementById("arrowSizeValue"),
  arrowAngleValue: document.getElementById("arrowAngleValue"),
  labelBgColorInput: document.getElementById("labelBgColorInput"),
  labelBgOpacityInput: document.getElementById("labelBgOpacityInput"),
  labelBgOpacityValue: document.getElementById("labelBgOpacityValue"),
  imageInfoValue: document.getElementById("imageInfoValue"),
  cursorInfoValue: document.getElementById("cursorInfoValue"),
  selectionInfoValue: document.getElementById("selectionInfoValue"),
  angleInfoValue: document.getElementById("angleInfoValue"),
  annotationCountValue: document.getElementById("annotationCountValue"),
  emptyState: document.getElementById("emptyState"),
  imageViewport: document.getElementById("imageViewport"),
  photo: document.getElementById("photo"),
  overlay: document.getElementById("overlay"),
  magnifier: document.getElementById("magnifier"),
  angleBadge: document.getElementById("angleBadge"),
  inlineLabelEditor: document.getElementById("inlineLabelEditor"),
  annotationItemTemplate: document.getElementById("annotationItemTemplate")
};

const defaults = {
  label: "",
  color: "#ffffff",
  textColor: "#ffffff",
  style: "solid",
  labelPosition: "above",
  lineWidth: 4,
  dashGap: 12,
  fontSize: 22,
  fontFamily: "Arial",
  arrowSize: 14,
  arrowStyle: "filled",
  arrowAngle: 28,
  labelBgColor: "#12141c",
  labelBgOpacity: 0.8
};

const arrowStyleLabels = {
  filled: "瀹炲績绠ご",
  triangle: "涓夎褰㈢澶?,
  open: "绌哄績绠ご",
  diamond: "鑿卞舰绔ご",
  bracket: "鎷彿褰?,
  tick: "鍕惧舰",
  bar: "鐭í鍒荤嚎",
  dot: "鍦嗙偣绔ご",
  slash: "鏂滃垏绔ご",
  none: "鏃犵澶?
};

function svgEl(name) {
  return document.createElementNS(SVG_NS, name);
}

function makeId() {
  return `dim-${Math.random().toString(36).slice(2, 10)}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewMetrics() {
  if (!state.image.naturalWidth || !dom.photo.clientWidth || !dom.photo.clientHeight) {
    return null;
  }

  return {
    naturalWidth: state.image.naturalWidth,
    naturalHeight: state.image.naturalHeight,
    viewWidth: dom.photo.clientWidth,
    viewHeight: dom.photo.clientHeight,
    scaleX: dom.photo.clientWidth / state.image.naturalWidth,
    scaleY: dom.photo.clientHeight / state.image.naturalHeight
  };
}

function imagePointToView(x, y) {
  const metrics = getViewMetrics();
  if (!metrics) {
    return { x: 0, y: 0 };
  }

  return {
    x: x * metrics.scaleX,
    y: y * metrics.scaleY
  };
}

function viewPointToImage(clientX, clientY) {
  const rect = dom.overlay.getBoundingClientRect();
  const metrics = getViewMetrics();
  if (!metrics) {
    return { x: 0, y: 0, viewX: 0, viewY: 0 };
  }

  const viewX = clamp(clientX - rect.left, 0, rect.width);
  const viewY = clamp(clientY - rect.top, 0, rect.height);

  return {
    x: viewX / metrics.scaleX,
    y: viewY / metrics.scaleY,
    viewX,
    viewY
  };
}

function getSelectedAnnotation() {
  return state.annotations.find((item) => item.id === state.selectedId) || null;
}

function normalizeOrientation(angleDegrees) {
  const normalized = ((angleDegrees % 180) + 180) % 180;
  return normalized > 90 ? 180 - normalized : normalized;
}

function getOrientationAngle(x1, y1, x2, y2) {
  return normalizeOrientation((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI);
}

function formatAngle(value) {
  if (!Number.isFinite(value)) {
    return "--";
  }
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}掳`;
}

function getAutoLabel(annotation) {
  const dx = annotation.x2 - annotation.x1;
  const dy = annotation.y2 - annotation.y1;
  return `${Math.round(Math.hypot(dx, dy))} px`;
}

function getDisplayLabel(annotation) {
  return annotation.label.trim() || getAutoLabel(annotation);
}

function snapshotState() {
  return JSON.parse(JSON.stringify(state.annotations));
}

function pushUndo() {
  state.undoStack.push(snapshotState());
  if (state.undoStack.length > 50) {
    state.undoStack.shift();
  }
  state.redoStack = [];
}

function undo() {
  if (state.undoStack.length === 0) {
    return;
  }
  state.redoStack.push(snapshotState());
  state.annotations = state.undoStack.pop();
  state.selectedId = state.annotations[0]?.id || null;
  syncControlsFromSelection();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function redo() {
  if (state.redoStack.length === 0) {
    return;
  }
  state.undoStack.push(snapshotState());
  state.annotations = state.redoStack.pop();
  state.selectedId = state.annotations[0]?.id || null;
  syncControlsFromSelection();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function getDashPattern(annotation, scale = 1) {
  const gap = annotation.dashGap * scale;
  if (annotation.style === "dashed") {
    return [gap * 1.7, gap];
  }
  if (annotation.style === "dotted") {
    // 浣跨敤鍩轰簬绾垮鐨勬瘮渚嬭绠楃偣澶у皬锛岀‘淇濈偣瓒冲澶т笉浼氳娓叉煋鎴愬渾鐐?    const dotSize = Math.max(Math.round(scale * annotation.lineWidth * 0.25), 2);
    return [dotSize, gap];
  }
  return [];
}

function createAnnotation(start, end) {
  return {
    id: makeId(),
    ...defaults,
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y
  };
}

function hexToRgba(hex, opacity) {
  const normalized = hex.replace("#", "");
  const safe = normalized.length === 3
    ? normalized.split("").map((part) => `${part}${part}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const red = parseInt(safe.slice(0, 2), 16);
  const green = parseInt(safe.slice(2, 4), 16);
  const blue = parseInt(safe.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(opacity, 0, 1)})`;
}

function getLabelFill(annotation) {
  return hexToRgba(annotation.labelBgColor, annotation.labelBgOpacity);
}

function getLabelFillOpacity(annotation) {
  return clamp(annotation.labelBgOpacity, 0, 1);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getArrowHalfSpan(annotation) {
  const spread = Math.tan(toRadians(annotation.arrowAngle)) * annotation.arrowSize * 0.9;
  return clamp(spread, annotation.arrowSize * 0.18, annotation.arrowSize * 1.4);
}

function getArrowStrokeWidth(annotation) {
  return Math.max(annotation.lineWidth * 0.9, 1.5);
}

function getArrowPrimitives(annotation) {
  const size = annotation.arrowSize;
  const halfSpan = getArrowHalfSpan(annotation);

  if (annotation.arrowStyle === "filled") {
    return [{
      type: "path",
      d: `M 0 0 L ${-size} ${halfSpan} L ${-size * 0.72} 0 L ${-size} ${-halfSpan} Z`,
      fill: true,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "triangle") {
    return [{
      type: "path",
      d: `M 0 0 L ${-size} ${halfSpan} L ${-size} ${-halfSpan} Z`,
      fill: true,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "open") {
    return [{
      type: "path",
      d: `M ${-size} ${halfSpan} L 0 0 L ${-size} ${-halfSpan}`,
      fill: false,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "diamond") {
    return [{
      type: "path",
      d: `M 0 0 L ${-size * 0.52} ${halfSpan * 0.88} L ${-size} 0 L ${-size * 0.52} ${-halfSpan * 0.88} Z`,
      fill: false,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "bracket") {
    return [{
      type: "path",
      d: `M ${-size * 0.3} ${halfSpan} L 0 ${halfSpan} L 0 ${-halfSpan} L ${-size * 0.3} ${-halfSpan}`,
      fill: false,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "tick") {
    return [{
      type: "path",
      d: `M ${-size * 0.6} ${halfSpan * 0.5} L 0 0 L ${-size * 0.5} ${-halfSpan * 0.8}`,
      fill: false,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "bar") {
    return [{
      type: "line",
      x1: 0,
      y1: size * 0.7,
      x2: 0,
      y2: -size * 0.7,
      fill: false,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "dot") {
    return [{
      type: "circle",
      cx: 0,
      cy: 0,
      r: size * 0.38,
      fill: true,
      stroke: true
    }];
  }

  if (annotation.arrowStyle === "slash") {
    return [{
      type: "line",
      x1: -size * 0.72,
      y1: halfSpan,
      x2: size * 0.08,
      y2: -halfSpan,
      fill: false,
      stroke: true
    }];
  }

  return [];
}

function getArrowHandleOffset(annotation) {
  if (annotation.arrowStyle === "none") {
    return 10;
  }
  if (annotation.arrowStyle === "dot") {
    return annotation.arrowSize * 0.5 + 8;
  }
  if (annotation.arrowStyle === "bar") {
    return annotation.arrowSize * 0.25 + 8;
  }
  return annotation.arrowSize + 8;
}

function getLineGeometry(x1, y1, x2, y2, annotation) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const labelOffsetBase = annotation.fontSize + 8;
  const labelOffset = annotation.labelPosition === "center"
    ? 0
    : labelOffsetBase * (annotation.labelPosition === "above" ? -1 : 1);

  return {
    dx,
    dy,
    length,
    ux,
    uy,
    nx,
    ny,
    labelCenterX: (x1 + x2) / 2 + nx * labelOffset,
    labelCenterY: (y1 + y2) / 2 + ny * labelOffset
  };
}

function getLabelBoxMetrics(text, annotation) {
  const paddingX = Math.max(8, Math.round(annotation.fontSize * 0.34));
  const paddingY = Math.max(4, Math.round(annotation.fontSize * 0.2));
  let textWidth = Math.max(annotation.fontSize * (text.length * 0.54), 24);

  if (LABEL_MEASURE_CONTEXT) {
    LABEL_MEASURE_CONTEXT.font = `700 ${annotation.fontSize}px "${annotation.fontFamily}"`;
    textWidth = Math.max(LABEL_MEASURE_CONTEXT.measureText(text).width, 24);
  }

  return {
    paddingX,
    paddingY,
    width: textWidth + paddingX * 2,
    height: annotation.fontSize + paddingY * 2
  };
}

function getDimensionLineLayout(x1, y1, x2, y2, annotation, labelText) {
  const geometry = getLineGeometry(x1, y1, x2, y2, annotation);
  const labelBox = getLabelBoxMetrics(labelText, annotation);
  const segments = [];

  if (annotation.labelPosition !== "center") {
    segments.push({ x1, y1, x2, y2 });
    return { geometry, labelBox, segments };
  }

  const clearance = labelBox.width / 2 + annotation.lineWidth / 2;
  const availableHalf = geometry.length / 2;

  if (clearance >= availableHalf) {
    return { geometry, labelBox, segments };
  }

  segments.push({
    x1,
    y1,
    x2: geometry.labelCenterX - geometry.ux * clearance,
    y2: geometry.labelCenterY - geometry.uy * clearance
  });
  segments.push({
    x1: geometry.labelCenterX + geometry.ux * clearance,
    y1: geometry.labelCenterY + geometry.uy * clearance,
    x2,
    y2
  });

  return { geometry, labelBox, segments };
}

function setPointer(point) {
  state.pointer = point;
  renderStatus();
}

function setAngleGuide(guide) {
  state.angleGuide = guide;
  renderStatus();
}

function pointFromEvent(event) {
  return viewPointToImage(event.clientX, event.clientY);
}

function getSnappedPoint(rawPoint, anchorPoint) {
  const angle = getOrientationAngle(anchorPoint.x, anchorPoint.y, rawPoint.x, rawPoint.y);
  const point = {
    x: rawPoint.x,
    y: rawPoint.y
  };
  let guide = {
    angle,
    snapped: false,
    label: ""
  };

  if (Math.abs(angle) <= ANGLE_SNAP_THRESHOLD) {
    point.y = anchorPoint.y;
    guide = {
      angle: 0,
      snapped: true,
      label: "姘村钩鍚搁檮"
    };
  } else if (Math.abs(90 - angle) <= ANGLE_SNAP_THRESHOLD) {
    point.x = anchorPoint.x;
    guide = {
      angle: 90,
      snapped: true,
      label: "鍨傜洿鍚搁檮"
    };
  }

  const viewPoint = imagePointToView(point.x, point.y);
  return {
    point: {
      ...point,
      viewX: viewPoint.x,
      viewY: viewPoint.y
    },
    guide
  };
}

function selectAnnotation(id) {
  if (state.editingId && state.editingId !== id) {
    closeInlineLabelEditor({ commit: true });
  }
  state.selectedId = id;
  syncControlsFromSelection();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function clearSelection() {
  closeInlineLabelEditor({ commit: true });
  state.selectedId = null;
  syncControlsFromSelection();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function syncControlsFromSelection() {
  const annotation = getSelectedAnnotation();
  const current = annotation || defaults;
  dom.labelInput.value = annotation ? annotation.label : "";
  dom.colorInput.value = current.color;
  dom.textColorInput.value = current.textColor;
  dom.styleInput.value = current.style;
  dom.labelPositionInput.value = current.labelPosition;
  dom.arrowStyleInput.value = current.arrowStyle;
  dom.arrowAngleInput.value = current.arrowAngle;
  dom.lineWidthInput.value = current.lineWidth;
  dom.dashGapInput.value = current.dashGap;
  dom.fontSizeInput.value = current.fontSize;
  dom.fontFamilyInput.value = current.fontFamily;
  dom.arrowSizeInput.value = current.arrowSize;
  dom.labelBgColorInput.value = current.labelBgColor;
  dom.labelBgOpacityInput.value = String(Math.round(current.labelBgOpacity * 100));
  updateValueReadouts();
}

function updateValueReadouts() {
  dom.lineWidthValue.textContent = `${dom.lineWidthInput.value} px`;
  dom.dashGapValue.textContent = `${dom.dashGapInput.value} px`;
  dom.fontSizeValue.textContent = `${dom.fontSizeInput.value} px`;
  dom.arrowSizeValue.textContent = `${dom.arrowSizeInput.value} px`;
  dom.arrowAngleValue.textContent = `${dom.arrowAngleInput.value}掳`;
  dom.labelBgOpacityValue.textContent = `${dom.labelBgOpacityInput.value}%`;
}

function updateActionState() {
  const hasSelection = Boolean(state.selectedId);
  const hasImage = Boolean(state.image.element);
  dom.deleteLineButton.disabled = !hasSelection;
  dom.duplicateLineButton.disabled = !hasSelection;
  dom.exportButton.disabled = !hasImage;
}

function renderStatus() {
  dom.imageInfoValue.textContent = state.image.naturalWidth
    ? `${state.image.naturalWidth} x ${state.image.naturalHeight}`
    : "鏈浇鍏?;
  dom.cursorInfoValue.textContent = state.pointer
    ? `${Math.round(state.pointer.x)}, ${Math.round(state.pointer.y)}`
    : "--";
  const selected = getSelectedAnnotation();
  dom.selectionInfoValue.textContent = selected ? getDisplayLabel(selected) : "鏃?;
  if (state.angleGuide) {
    dom.angleInfoValue.textContent = state.angleGuide.snapped
      ? `${formatAngle(state.angleGuide.angle)} | ${state.angleGuide.label}`
      : formatAngle(state.angleGuide.angle);
  } else if (selected) {
    dom.angleInfoValue.textContent = formatAngle(getOrientationAngle(selected.x1, selected.y1, selected.x2, selected.y2));
  } else {
    dom.angleInfoValue.textContent = "--";
  }
  dom.annotationCountValue.textContent = String(state.annotations.length);
}

function renderAnnotationList() {
  dom.annotationList.innerHTML = "";

  if (!state.annotations.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "鏆傛棤鏍囨敞";
    dom.annotationList.appendChild(empty);
    return;
  }

  state.annotations.forEach((annotation, index) => {
    const node = dom.annotationItemTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = annotation.id;
    node.querySelector(".annotation-name").textContent = getDisplayLabel(annotation);
    node.querySelector(".annotation-meta").textContent = `鏍囨敞 ${index + 1} | ${arrowStyleLabels[annotation.arrowStyle]} | ${annotation.lineWidth}px`;
    if (annotation.id === state.selectedId) {
      node.classList.add("active");
    }
    node.addEventListener("click", () => selectAnnotation(annotation.id));
    dom.annotationList.appendChild(node);
  });
}

function renderOverlay() {
  const metrics = getViewMetrics();
  dom.overlay.innerHTML = "";

  if (!metrics) {
    renderAngleBadge();
    return;
  }

  dom.overlay.setAttribute("viewBox", `0 0 ${metrics.viewWidth} ${metrics.viewHeight}`);

  if (state.pointer) {
    renderCrosshair(metrics);
  }

  state.annotations.forEach((annotation) => {
    const group = svgEl("g");
    const start = imagePointToView(annotation.x1, annotation.y1);
    const end = imagePointToView(annotation.x2, annotation.y2);
    const labelText = getDisplayLabel(annotation);
    const lineLayout = getDimensionLineLayout(start.x, start.y, end.x, end.y, annotation, labelText);
    const geometry = lineLayout.geometry;

    const hitLine = svgEl("line");
    hitLine.setAttribute("x1", String(start.x));
    hitLine.setAttribute("y1", String(start.y));
    hitLine.setAttribute("x2", String(end.x));
    hitLine.setAttribute("y2", String(end.y));
    hitLine.setAttribute("class", "hit-line");
    hitLine.setAttribute("stroke-width", "24");
    hitLine.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectAnnotation(annotation.id);
      beginDrag(event, { type: "line", id: annotation.id });
    });
    group.appendChild(hitLine);

    const labelHitArea = svgEl("rect");
    const labelPadding = 20;
    const labelAngle = Math.atan2(geometry.dy, geometry.dx) * 180 / Math.PI;
    labelHitArea.setAttribute("x", String(geometry.labelCenterX - 60 - labelPadding));
    labelHitArea.setAttribute("y", String(geometry.labelCenterY - 20 - labelPadding));
    labelHitArea.setAttribute("width", "120");
    labelHitArea.setAttribute("height", "40");
    labelHitArea.setAttribute("fill", "transparent");
    labelHitArea.setAttribute("stroke", "none");
    labelHitArea.setAttribute("class", "label-hit-area");
    labelHitArea.setAttribute("transform", `rotate(${labelAngle} ${geometry.labelCenterX} ${geometry.labelCenterY})`);
    labelHitArea.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      selectAnnotation(annotation.id);
      beginDrag(event, { type: "line", id: annotation.id });
    });
    group.appendChild(labelHitArea);

    const dashArray = getDashPattern(annotation);
    lineLayout.segments.forEach((segment) => {
      const line = svgEl("line");
      line.setAttribute("x1", String(segment.x1));
      line.setAttribute("y1", String(segment.y1));
      line.setAttribute("x2", String(segment.x2));
      line.setAttribute("y2", String(segment.y2));
      line.setAttribute("stroke", annotation.color);
      line.setAttribute("stroke-width", String(annotation.lineWidth));
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("class", "visible-line");
      if (dashArray.length) {
        line.setAttribute("stroke-dasharray", dashArray.join(" "));
      }
      group.appendChild(line);
    });

    appendArrowSvg(group, start.x, start.y, Math.atan2(geometry.dy, geometry.dx) + Math.PI, annotation);
    appendArrowSvg(group, end.x, end.y, Math.atan2(geometry.dy, geometry.dx), annotation);

    const label = drawSvgLabel(labelText, geometry.labelCenterX, geometry.labelCenterY, annotation, labelAngle);
    label.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    label.addEventListener("click", (event) => {
      event.stopPropagation();
      selectAnnotation(annotation.id);
      openInlineLabelEditor(annotation.id);
    });
    group.appendChild(label);

    if (annotation.id === state.selectedId) {
      group.classList.add("selected");
      const handleOffset = getArrowHandleOffset(annotation);
      const handlePoints = [
        ["x1", { x: start.x - geometry.ux * handleOffset, y: start.y - geometry.uy * handleOffset }],
        ["x2", { x: end.x + geometry.ux * handleOffset, y: end.y + geometry.uy * handleOffset }]
      ];
      handlePoints.forEach(([key, point]) => {
        const circle = svgEl("circle");
        circle.setAttribute("cx", String(point.x));
        circle.setAttribute("cy", String(point.y));
        circle.setAttribute("r", "5.5");
        circle.setAttribute("fill", "#ffffff");
        circle.setAttribute("stroke", "rgba(18, 32, 51, 0.88)");
        circle.setAttribute("stroke-width", "2");
        circle.setAttribute("class", "endpoint");
        circle.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          beginDrag(event, { type: "endpoint", id: annotation.id, point: key });
        });
        group.appendChild(circle);
      });
    }

    group.addEventListener("click", () => selectAnnotation(annotation.id));
    dom.overlay.appendChild(group);
  });

  positionInlineLabelEditor();
  renderAngleBadge();
}

function renderCrosshair(metrics) {
  const crosshairClass = state.angleGuide?.snapped ? "crosshair-line snapped" : "crosshair-line";
  const vertical = svgEl("line");
  vertical.setAttribute("x1", String(state.pointer.viewX));
  vertical.setAttribute("y1", "0");
  vertical.setAttribute("x2", String(state.pointer.viewX));
  vertical.setAttribute("y2", String(metrics.viewHeight));
  vertical.setAttribute("class", crosshairClass);
  dom.overlay.appendChild(vertical);

  const horizontal = svgEl("line");
  horizontal.setAttribute("x1", "0");
  horizontal.setAttribute("y1", String(state.pointer.viewY));
  horizontal.setAttribute("x2", String(metrics.viewWidth));
  horizontal.setAttribute("y2", String(state.pointer.viewY));
  horizontal.setAttribute("class", crosshairClass);
  dom.overlay.appendChild(horizontal);

  const core = svgEl("circle");
  core.setAttribute("cx", String(state.pointer.viewX));
  core.setAttribute("cy", String(state.pointer.viewY));
  core.setAttribute("r", "3");
  core.setAttribute("class", "crosshair-core");
  dom.overlay.appendChild(core);
}

function drawSvgLabel(text, x, y, annotation, angle = 0) {
  const group = svgEl("g");
  const labelBox = getLabelBoxMetrics(text, annotation);
  const width = labelBox.width;
  const height = labelBox.height;

  const rect = svgEl("rect");
  rect.setAttribute("x", String(x - width / 2));
  rect.setAttribute("y", String(y - height / 2));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("rx", String(height / 2));
  rect.setAttribute("class", "label-bg");
  rect.setAttribute("fill", annotation.labelBgColor);
  rect.setAttribute("fill-opacity", String(getLabelFillOpacity(annotation)));
  rect.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
  group.appendChild(rect);

  const textNode = svgEl("text");
  textNode.setAttribute("x", String(x));
  textNode.setAttribute("y", String(y + annotation.fontSize * 0.35 - 1));
  textNode.setAttribute("text-anchor", "middle");
  textNode.setAttribute("font-size", String(annotation.fontSize));
  textNode.setAttribute("font-family", annotation.fontFamily);
  textNode.setAttribute("font-weight", "700");
  textNode.setAttribute("fill", annotation.textColor);
  textNode.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
  textNode.textContent = text;
  group.appendChild(textNode);

  return group;
}

function appendArrowSvg(parent, x, y, angle, annotation) {
  if (annotation.arrowStyle === "none") {
    return;
  }

  const group = svgEl("g");
  group.setAttribute("transform", `translate(${x} ${y}) rotate(${(angle * 180) / Math.PI})`);
  group.setAttribute("stroke", annotation.color);
  group.setAttribute("fill", annotation.color);
  group.setAttribute("stroke-width", String(getArrowStrokeWidth(annotation)));
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");

  getArrowPrimitives(annotation).forEach((primitive) => {
    const node = svgEl(primitive.type);
    if (primitive.type === "path") {
      node.setAttribute("d", primitive.d);
    } else if (primitive.type === "line") {
      node.setAttribute("x1", String(primitive.x1));
      node.setAttribute("y1", String(primitive.y1));
      node.setAttribute("x2", String(primitive.x2));
      node.setAttribute("y2", String(primitive.y2));
    } else if (primitive.type === "circle") {
      node.setAttribute("cx", String(primitive.cx));
      node.setAttribute("cy", String(primitive.cy));
      node.setAttribute("r", String(primitive.r));
    }

    if (!primitive.fill) {
      node.setAttribute("fill", "none");
    }
    if (!primitive.stroke) {
      node.setAttribute("stroke", "none");
    }
    group.appendChild(node);
  });

  parent.appendChild(group);
}

function beginCreate(event) {
  if (!state.image.naturalWidth || event.button !== 0) {
    return;
  }

  closeInlineLabelEditor({ commit: true });
  event.preventDefault();
  dom.overlay.setPointerCapture(event.pointerId);
  state.mode = "creating";
  state.draftAnnotationId = null;
  setAngleGuide(null);
  updateDraftOrDrag(event);
}

function beginDrag(event, dragTarget) {
  if (!state.image.naturalWidth) {
    return;
  }

  closeInlineLabelEditor({ commit: true });
  const annotation = state.annotations.find((item) => item.id === dragTarget.id);
  if (!annotation) {
    return;
  }

  event.preventDefault();
  dom.overlay.setPointerCapture(event.pointerId);
  state.mode = "dragging";
  setAngleGuide(null);
  state.dragTarget = {
    ...dragTarget,
    pointerId: event.pointerId,
    origin: pointFromEvent(event),
    snapshot: {
      x1: annotation.x1,
      y1: annotation.y1,
      x2: annotation.x2,
      y2: annotation.y2
    }
  };
  setPointer(state.dragTarget.origin);
  showMagnifier(event.clientX, event.clientY);
}

function updateDraftOrDrag(event) {
  const rawPoint = pointFromEvent(event);
  let point = rawPoint;
  let angleGuide = null;

  if (state.mode === "creating") {
    if (!state.draftAnnotationId) {
      const draft = createAnnotation(point, point);
      state.annotations.push(draft);
      state.draftAnnotationId = draft.id;
      state.selectedId = draft.id;
      syncControlsFromSelection();
    } else {
      const annotation = state.annotations.find((item) => item.id === state.draftAnnotationId);
      if (annotation) {
        const snapped = getSnappedPoint(rawPoint, { x: annotation.x1, y: annotation.y1 });
        point = snapped.point;
        angleGuide = snapped.guide;
        annotation.x2 = point.x;
        annotation.y2 = point.y;
      }
    }
    setPointer(point);
    setAngleGuide(angleGuide);
    renderAnnotationList();
    renderOverlay();
    renderStatus();
    updateActionState();
    showMagnifier(event.clientX, event.clientY);
    return;
  }

  if (state.mode === "dragging" && state.dragTarget) {
    const annotation = state.annotations.find((item) => item.id === state.dragTarget.id);
    if (!annotation) {
      return;
    }

    point = rawPoint;
    const deltaX = point.x - state.dragTarget.origin.x;
    const deltaY = point.y - state.dragTarget.origin.y;

    if (state.dragTarget.type === "endpoint") {
      const anchorPoint = state.dragTarget.point === "x1"
        ? { x: annotation.x2, y: annotation.y2 }
        : { x: annotation.x1, y: annotation.y1 };
      const snapped = getSnappedPoint(rawPoint, anchorPoint);
      point = snapped.point;
      angleGuide = snapped.guide;
      annotation[state.dragTarget.point] = point.x;
      annotation[state.dragTarget.point === "x1" ? "y1" : "y2"] = point.y;
    } else {
      annotation.x1 = clamp(state.dragTarget.snapshot.x1 + deltaX, 0, state.image.naturalWidth);
      annotation.y1 = clamp(state.dragTarget.snapshot.y1 + deltaY, 0, state.image.naturalHeight);
      annotation.x2 = clamp(state.dragTarget.snapshot.x2 + deltaX, 0, state.image.naturalWidth);
      annotation.y2 = clamp(state.dragTarget.snapshot.y2 + deltaY, 0, state.image.naturalHeight);
    }

    setPointer(point);
    setAngleGuide(angleGuide);
    renderAnnotationList();
    renderOverlay();
    renderStatus();
    showMagnifier(event.clientX, event.clientY);
  }
}

function endPointerAction(event) {
  if (event && dom.overlay.hasPointerCapture(event.pointerId)) {
    dom.overlay.releasePointerCapture(event.pointerId);
  }

  if (state.mode === "creating") {
    const annotation = state.annotations.find((item) => item.id === state.draftAnnotationId);
    if (annotation) {
      const length = Math.hypot(annotation.x2 - annotation.x1, annotation.y2 - annotation.y1);
      if (length < 6) {
        state.annotations = state.annotations.filter((item) => item.id !== annotation.id);
        state.selectedId = state.annotations[0]?.id || null;
      } else {
        pushUndo();
      }
    }
    state.mode = "idle";
    state.draftAnnotationId = null;
  } else if (state.mode === "dragging") {
    pushUndo();
    state.mode = "idle";
    state.dragTarget = null;
  }

  setAngleGuide(null);
  hideMagnifier();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function applyControlChanges() {
  const annotation = getSelectedAnnotation();
  if (!annotation) {
    updateValueReadouts();
    return;
  }

  annotation.label = dom.labelInput.value;
  annotation.color = dom.colorInput.value;
  annotation.textColor = dom.textColorInput.value;
  annotation.style = dom.styleInput.value;
  annotation.labelPosition = dom.labelPositionInput.value;
  annotation.arrowStyle = dom.arrowStyleInput.value;
  annotation.arrowAngle = Number(dom.arrowAngleInput.value);
  annotation.lineWidth = Number(dom.lineWidthInput.value);
  annotation.dashGap = Number(dom.dashGapInput.value);
  annotation.fontSize = Number(dom.fontSizeInput.value);
  annotation.fontFamily = dom.fontFamilyInput.value;
  annotation.arrowSize = Number(dom.arrowSizeInput.value);
  annotation.labelBgColor = dom.labelBgColorInput.value;
  annotation.labelBgOpacity = Number(dom.labelBgOpacityInput.value) / 100;

  updateValueReadouts();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
}

function deleteSelectedAnnotation() {
  if (!state.selectedId) {
    return;
  }

  pushUndo();
  closeInlineLabelEditor({ commit: false });
  state.annotations = state.annotations.filter((item) => item.id !== state.selectedId);
  state.selectedId = state.annotations[0]?.id || null;
  syncControlsFromSelection();
  renderAnnotationList();
  renderOverlay();
  renderStatus();
  updateActionState();
}

function duplicateSelectedAnnotation() {
  const annotation = getSelectedAnnotation();
  if (!annotation) {
    return;
  }

  pushUndo();
  const clone = {
    ...annotation,
    id: makeId(),
    x1: clamp(annotation.x1 + 30, 0, state.image.naturalWidth),
    y1: clamp(annotation.y1 + 30, 0, state.image.naturalHeight),
    x2: clamp(annotation.x2 + 30, 0, state.image.naturalWidth),
    y2: clamp(annotation.y2 + 30, 0, state.image.naturalHeight)
  };
  state.annotations.push(clone);
  selectAnnotation(clone.id);
}

function loadImage(file) {
  if (!file) {
    return;
  }

  closeInlineLabelEditor({ commit: false });
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      state.image = {
        element: img,
        src: reader.result,
        name: file.name.replace(/\.[^.]+$/, ""),
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      };
      dom.photo.src = reader.result;
      dom.emptyState.classList.add("hidden");
      dom.imageViewport.classList.remove("hidden");
      state.annotations = [];
      state.selectedId = null;
      state.pointer = null;
      state.angleGuide = null;
      syncControlsFromSelection();
      renderAnnotationList();
      renderStatus();
      updateActionState();
      requestAnimationFrame(renderOverlay);
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function showMagnifier(clientX, clientY) {
  const point = viewPointToImage(clientX, clientY);
  const ctx = dom.magnifier.getContext("2d");
  const source = state.image.element;

  if (!source || !ctx) {
    return;
  }

  const zoom = 6;
  const sampleSize = 28;
  const sx = clamp(point.x - sampleSize / 2, 0, state.image.naturalWidth - sampleSize);
  const sy = clamp(point.y - sampleSize / 2, 0, state.image.naturalHeight - sampleSize);

  ctx.clearRect(0, 0, dom.magnifier.width, dom.magnifier.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, sx, sy, sampleSize, sampleSize, 0, 0, sampleSize * zoom, sampleSize * zoom);

  ctx.strokeStyle = "rgba(255,255,255,0.96)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(dom.magnifier.width / 2, 0);
  ctx.lineTo(dom.magnifier.width / 2, dom.magnifier.height);
  ctx.moveTo(0, dom.magnifier.height / 2);
  ctx.lineTo(dom.magnifier.width, dom.magnifier.height / 2);
  ctx.stroke();

  dom.magnifier.classList.remove("hidden");
  const viewportRect = dom.imageViewport.getBoundingClientRect();
  const localX = clientX - viewportRect.left;
  const localY = clientY - viewportRect.top;
  const offsetX = localX + 24 + dom.magnifier.width > viewportRect.width ? -dom.magnifier.width - 24 : 24;
  const offsetY = localY + 24 + dom.magnifier.height > viewportRect.height ? -dom.magnifier.height - 24 : 24;
  dom.magnifier.style.left = `${localX + offsetX}px`;
  dom.magnifier.style.top = `${localY + offsetY}px`;
}

function hideMagnifier() {
  dom.magnifier.classList.add("hidden");
}

function renderAngleBadge() {
  const shouldShow = Boolean(
    state.image.naturalWidth &&
    state.pointer &&
    state.angleGuide &&
    (state.mode === "creating" || (state.mode === "dragging" && state.dragTarget?.type === "endpoint"))
  );

  if (!shouldShow) {
    dom.angleBadge.classList.add("hidden");
    return;
  }

  dom.angleBadge.textContent = state.angleGuide.snapped
    ? `${formatAngle(state.angleGuide.angle)} ${state.angleGuide.label}`
    : formatAngle(state.angleGuide.angle);
  dom.angleBadge.style.left = `${state.pointer.viewX + 18}px`;
  dom.angleBadge.style.top = `${state.pointer.viewY - 20}px`;
  dom.angleBadge.classList.remove("hidden");
}

function exportImage() {
  if (!state.image.element) {
    window.alert("璇峰厛涓婁紶鐓х墖銆?);
    return;
  }

  const format = dom.exportFormatInput.value;
  const fileName = state.image.name || "dimension-markup";

  if (format === "svg") {
    exportAsSvg(fileName);
  } else if (format === "pdf") {
    exportAsPdf(fileName);
  } else {
    exportAsImage(fileName, format);
  }
}

function exportAsImage(fileName, format) {
  const canvas = document.createElement("canvas");
  canvas.width = state.image.naturalWidth;
  canvas.height = state.image.naturalHeight;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(state.image.element, 0, 0, canvas.width, canvas.height);
  state.annotations.forEach((annotation) => drawAnnotationToCanvas(ctx, annotation));

  const mimeType = format === "jpg" ? "image/jpeg" : "image/png";
  const quality = format === "jpg" ? 1.0 : undefined;

  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${fileName}-marked.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, mimeType, quality);
}

function exportAsPdf(fileName) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: state.image.naturalWidth > state.image.naturalHeight ? "landscape" : "portrait",
    unit: "px",
    format: [state.image.naturalWidth, state.image.naturalHeight]
  });

  const canvas = document.createElement("canvas");
  canvas.width = state.image.naturalWidth;
  canvas.height = state.image.naturalHeight;
  const ctx = canvas.getContext("2d");

  ctx.drawImage(state.image.element, 0, 0, canvas.width, canvas.height);
  state.annotations.forEach((annotation) => drawAnnotationToCanvas(ctx, annotation));

  const imgData = canvas.toDataURL("image/png");
  pdf.addImage(imgData, "PNG", 0, 0, state.image.naturalWidth, state.image.naturalHeight);
  pdf.save(`${fileName}-marked.pdf`);
}

function exportAsSvg(fileName) {
  if (!state.image.naturalWidth) {
    return;
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(state.image.naturalWidth));
  svg.setAttribute("height", String(state.image.naturalHeight));
  svg.setAttribute("viewBox", `0 0 ${state.image.naturalWidth} ${state.image.naturalHeight}`);

  const img = document.createElementNS(SVG_NS, "image");
  img.setAttribute("href", state.image.src);
  img.setAttribute("width", String(state.image.naturalWidth));
  img.setAttribute("height", String(state.image.naturalHeight));
  svg.appendChild(img);

  const g = document.createElementNS(SVG_NS, "g");
  state.annotations.forEach((annotation) => {
    const group = createAnnotationSvg(annotation);
    g.appendChild(group);
  });
  svg.appendChild(g);

  const svgData = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([svgData], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}-marked.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createAnnotationSvg(annotation) {
  // 鍧愭爣鐢ㄨ嚜鐒跺浘鐗囩┖闂达紝瑙嗚灞炴€ф寜姣斾緥缂╂斁浠ュ尮閰嶉瑙堟晥鏋?  const metrics = getViewMetrics();
  const scale = metrics ? Math.min(
    state.image.naturalWidth / metrics.viewWidth,
    state.image.naturalHeight / metrics.viewHeight
  ) : 1;

  const startX = annotation.x1;
  const startY = annotation.y1;
  const endX = annotation.x2;
  const endY = annotation.y2;

  const scaledAnnotation = {
    ...annotation,
    fontSize: annotation.fontSize * scale,
    arrowSize: annotation.arrowSize * scale,
    lineWidth: annotation.lineWidth * scale,
    dashGap: annotation.dashGap * scale
  };

  const group = document.createElementNS(SVG_NS, "g");
  const labelText = getDisplayLabel(annotation);
  const lineLayout = getDimensionLineLayout(startX, startY, endX, endY, scaledAnnotation, labelText);
  const dashArray = getDashPattern(annotation).map(v => v * scale);
  lineLayout.segments.forEach((segment) => {
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(segment.x1));
    line.setAttribute("y1", String(segment.y1));
    line.setAttribute("x2", String(segment.x2));
    line.setAttribute("y2", String(segment.y2));
    line.setAttribute("stroke", annotation.color);
    line.setAttribute("stroke-width", String(scaledAnnotation.lineWidth));
    line.setAttribute("stroke-linecap", "round");
    if (dashArray.length) {
      line.setAttribute("stroke-dasharray", dashArray.join(" "));
    }
    group.appendChild(line);
  });

  const angle = Math.atan2(endY - startY, endX - startX);
  appendArrowSvg(group, startX, startY, angle + Math.PI, scaledAnnotation);
  appendArrowSvg(group, endX, endY, angle, scaledAnnotation);

  const labelGroup = createSvgLabel(labelText, scaledAnnotation, startX, startY, endX, endY);
  group.appendChild(labelGroup);

  return group;
}

function createSvgLabel(text, annotation, startX, startY, endX, endY) {
  const g = document.createElementNS(SVG_NS, "g");
  const geometry = getLineGeometry(startX, startY, endX, endY, annotation);
  const labelAngle = Math.atan2(geometry.dy, geometry.dx) * 180 / Math.PI;
  const labelBox = getLabelBoxMetrics(text, annotation);
  const width = labelBox.width;
  const height = labelBox.height;

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(geometry.labelCenterX - width / 2));
  rect.setAttribute("y", String(geometry.labelCenterY - height / 2));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("rx", String(height / 2));
  rect.setAttribute("fill", annotation.labelBgColor);
  rect.setAttribute("fill-opacity", String(getLabelFillOpacity(annotation)));
  rect.setAttribute("transform", `rotate(${labelAngle} ${geometry.labelCenterX} ${geometry.labelCenterY})`);
  g.appendChild(rect);

  const textEl = document.createElementNS(SVG_NS, "text");
  textEl.setAttribute("x", String(geometry.labelCenterX));
  textEl.setAttribute("y", String(geometry.labelCenterY + annotation.fontSize * 0.35 - 1));
  textEl.setAttribute("text-anchor", "middle");
  textEl.setAttribute("font-size", String(annotation.fontSize));
  textEl.setAttribute("font-family", annotation.fontFamily);
  textEl.setAttribute("font-weight", "700");
  textEl.setAttribute("fill", annotation.textColor);
  textEl.setAttribute("transform", `rotate(${labelAngle} ${geometry.labelCenterX} ${geometry.labelCenterY})`);
  textEl.textContent = text;
  g.appendChild(textEl);

  return g;
}

function drawAnnotationToCanvas(ctx, annotation) {
  // 鍧愭爣鐢ㄨ嚜鐒跺浘鐗囩┖闂达紝瑙嗚灞炴€ф寜姣斾緥缂╂斁浠ュ尮閰嶉瑙堟晥鏋?  const metrics = getViewMetrics();
  const scale = metrics ? Math.min(
    state.image.naturalWidth / metrics.viewWidth,
    state.image.naturalHeight / metrics.viewHeight
  ) : 1;

  const startX = annotation.x1;
  const startY = annotation.y1;
  const endX = annotation.x2;
  const endY = annotation.y2;

  const scaledAnnotation = {
    ...annotation,
    fontSize: annotation.fontSize * scale,
    arrowSize: annotation.arrowSize * scale,
    lineWidth: annotation.lineWidth * scale,
    dashGap: annotation.dashGap * scale
  };

  const labelText = getDisplayLabel(annotation);
  const lineLayout = getDimensionLineLayout(startX, startY, endX, endY, scaledAnnotation, labelText);
  const geometry = lineLayout.geometry;

  // --- 缁樺埗绾挎 ---
  ctx.save();
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = scaledAnnotation.lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash(getDashPattern(annotation).map(v => v * scale));

  if (lineLayout.segments.length) {
    ctx.beginPath();
    lineLayout.segments.forEach((segment) => {
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
    });
    ctx.stroke();
  }

  drawArrowDecoration(ctx, startX, startY, Math.atan2(geometry.dy, geometry.dx) + Math.PI, scaledAnnotation);
  drawArrowDecoration(ctx, endX, endY, Math.atan2(geometry.dy, geometry.dx), scaledAnnotation);

  // --- 缁樺埗鏍囩 ---
  ctx.font = `700 ${scaledAnnotation.fontSize}px "${annotation.fontFamily}"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const boxWidth = lineLayout.labelBox.width;
  const boxHeight = lineLayout.labelBox.height;

  ctx.save();
  ctx.translate(geometry.labelCenterX, geometry.labelCenterY);
  ctx.rotate(Math.atan2(geometry.dy, geometry.dx));
  ctx.translate(-geometry.labelCenterX, -geometry.labelCenterY);

  ctx.fillStyle = getLabelFill(annotation);
  drawRoundedRect(ctx, geometry.labelCenterX - boxWidth / 2, geometry.labelCenterY - boxHeight / 2, boxWidth, boxHeight, boxHeight / 2);
  ctx.fill();

  ctx.fillStyle = annotation.textColor;
  ctx.fillText(labelText, geometry.labelCenterX, geometry.labelCenterY + 1);
  ctx.restore();
}

function drawArrowDecoration(ctx, x, y, angle, annotation) {
  if (annotation.arrowStyle === "none") {
    return;
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = annotation.color;
  ctx.fillStyle = annotation.color;
  ctx.lineWidth = getArrowStrokeWidth(annotation);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);

  getArrowPrimitives(annotation).forEach((primitive) => {
    ctx.beginPath();
    if (primitive.type === "path") {
      const path = new Path2D(primitive.d);
      if (primitive.fill) {
        ctx.fill(path);
      }
      if (primitive.stroke) {
        ctx.stroke(path);
      }
      return;
    }

    if (primitive.type === "line") {
      ctx.moveTo(primitive.x1, primitive.y1);
      ctx.lineTo(primitive.x2, primitive.y2);
    } else if (primitive.type === "circle") {
      ctx.arc(primitive.cx, primitive.cy, primitive.r, 0, Math.PI * 2);
    }

    if (primitive.fill) {
      ctx.fill();
    }
    if (primitive.stroke) {
      ctx.stroke();
    }
  });

  ctx.restore();
}

function openInlineLabelEditor(annotationId) {
  const annotation = state.annotations.find((item) => item.id === annotationId);
  if (!annotation) {
    return;
  }

  state.editingId = annotationId;
  const editor = dom.inlineLabelEditor;
  editor.value = annotation.label.trim() || getAutoLabel(annotation);
  editor.dataset.originalCustom = annotation.label.trim();
  editor.dataset.originalAuto = getAutoLabel(annotation);
  editor.classList.remove("hidden");
  positionInlineLabelEditor();
  requestAnimationFrame(() => {
    editor.focus();
    editor.select();
  });
}

function closeInlineLabelEditor({ commit } = { commit: true }) {
  if (!state.editingId) {
    return;
  }

  const editor = dom.inlineLabelEditor;
  const annotation = state.annotations.find((item) => item.id === state.editingId);
  const originalCustom = editor.dataset.originalCustom || "";
  const originalAuto = editor.dataset.originalAuto || "";

  if (commit && annotation) {
    const value = editor.value.trim();
    annotation.label = !value || (!originalCustom && value === originalAuto) ? "" : value;
    if (annotation.id === state.selectedId) {
      dom.labelInput.value = annotation.label;
    }
  }

  state.editingId = null;
  editor.value = "";
  editor.classList.add("hidden");
  delete editor.dataset.originalCustom;
  delete editor.dataset.originalAuto;
  renderAnnotationList();
  renderOverlay();
  renderStatus();
}

function positionInlineLabelEditor() {
  if (!state.editingId || dom.inlineLabelEditor.classList.contains("hidden")) {
    return;
  }

  const annotation = state.annotations.find((item) => item.id === state.editingId);
  if (!annotation) {
    return;
  }

  const start = imagePointToView(annotation.x1, annotation.y1);
  const end = imagePointToView(annotation.x2, annotation.y2);
  const geometry = getLineGeometry(start.x, start.y, end.x, end.y, annotation);
  const editor = dom.inlineLabelEditor;
  const display = annotation.label.trim() || getAutoLabel(annotation);
  const width = Math.max(120, Math.min(240, display.length * annotation.fontSize * 0.62));

  editor.style.left = `${geometry.labelCenterX}px`;
  editor.style.top = `${geometry.labelCenterY}px`;
  editor.style.width = `${width}px`;
  editor.style.fontSize = `${Math.max(annotation.fontSize - 1, 11)}px`;
  editor.style.fontFamily = annotation.fontFamily;
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

dom.imageInput.addEventListener("change", (event) => loadImage(event.target.files?.[0]));
dom.deleteLineButton.addEventListener("click", deleteSelectedAnnotation);
dom.duplicateLineButton.addEventListener("click", duplicateSelectedAnnotation);
dom.exportButton.addEventListener("click", exportImage);

[
  dom.labelInput,
  dom.colorInput,
  dom.textColorInput,
  dom.styleInput,
  dom.labelPositionInput,
  dom.arrowStyleInput,
  dom.arrowAngleInput,
  dom.lineWidthInput,
  dom.dashGapInput,
  dom.fontSizeInput,
  dom.fontFamilyInput,
  dom.arrowSizeInput,
  dom.labelBgColorInput,
  dom.labelBgOpacityInput
].forEach((control) => {
  control.addEventListener("input", applyControlChanges);
});

dom.overlay.addEventListener("pointerdown", (event) => {
  beginCreate(event);
});

dom.overlay.addEventListener("pointermove", (event) => {
  if (state.mode === "creating" || state.mode === "dragging") {
    updateDraftOrDrag(event);
  } else {
    setPointer(pointFromEvent(event));
    setAngleGuide(null);
    renderOverlay();
  }
});

dom.overlay.addEventListener("pointerup", endPointerAction);
dom.overlay.addEventListener("pointercancel", endPointerAction);
dom.overlay.addEventListener("pointerleave", () => {
  if (state.mode === "idle") {
    setPointer(null);
    setAngleGuide(null);
    renderOverlay();
  }
});

window.addEventListener("resize", renderOverlay);
dom.photo.addEventListener("load", renderOverlay);
dom.inlineLabelEditor.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    closeInlineLabelEditor({ commit: true });
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closeInlineLabelEditor({ commit: false });
  }
});
dom.inlineLabelEditor.addEventListener("blur", () => {
  closeInlineLabelEditor({ commit: true });
});
window.addEventListener("keydown", (event) => {
  const activeElement = document.activeElement;
  const tagName = activeElement?.tagName || "";
  const isTextEditing = /INPUT|TEXTAREA|SELECT/.test(tagName) || activeElement?.isContentEditable;

  if (event.ctrlKey || event.metaKey) {
    if (event.key === "z" || event.key === "Z") {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === "u" || event.key === "U") {
      event.preventDefault();
      redo();
      return;
    }
  }

  if (!isTextEditing && (event.key === "Delete" || event.key === "Backspace")) {
    if (state.selectedId) {
      event.preventDefault();
      deleteSelectedAnnotation();
    }
  }
});

syncControlsFromSelection();
renderAnnotationList();
renderStatus();
updateActionState();
