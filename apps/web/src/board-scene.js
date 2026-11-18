const cameras = new WeakMap();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function fitScale(board, camera) {
  const stage = board.parentElement?.parentElement;
  const width = board.offsetWidth;
  const height = board.offsetHeight;
  if (!stage?.classList.contains("board-stage") || !width || !height) return 1;

  const radians = camera.rotation * Math.PI / 180;
  const rotatedWidth = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
  const rotatedHeight = Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height;
  return clamp(Math.min((stage.clientWidth - 24) / rotatedWidth, (stage.clientHeight - 24) / rotatedHeight), 0.45, 1);
}

function setCameraStyle(board, camera) {
  board.style.setProperty("--camera-rotation", `${camera.rotation}deg`);
  board.style.setProperty("--camera-fit", fitScale(board, camera).toFixed(3));
  board.style.setProperty("--camera-zoom", camera.zoom.toFixed(3));
}

function resetCamera(board, camera) {
  camera.rotation = 0;
  camera.zoom = 1;
  setCameraStyle(board, camera);
}

function distanceBetween(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function initializeBoardCamera(board, wrapper = board?.parentElement) {
  if (!board) return null;
  if (cameras.has(board)) return cameras.get(board);

  const camera = {
    rotation: 0,
    zoom: 1,
    pointers: new Map(),
    drag: null,
    pinchDistance: 0,
    suppressClick: false,
  };
  cameras.set(board, camera);
  setCameraStyle(board, camera);

  document.querySelector("#camera-reset")?.addEventListener("click", () => resetCamera(board, camera));

  board.addEventListener("contextmenu", (event) => event.preventDefault());
  board.addEventListener("click", (event) => {
    if (!camera.suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    camera.suppressClick = false;
  }, true);

  board.addEventListener("pointerdown", (event) => {
    camera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (camera.pointers.size === 2) {
      const [first, second] = [...camera.pointers.values()];
      camera.pinchDistance = distanceBetween(first, second);
      camera.drag = null;
      return;
    }
    if (camera.pointers.size !== 1 || event.button !== 0) return;
    camera.drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  });

  board.addEventListener("pointermove", (event) => {
    if (!camera.pointers.has(event.pointerId)) return;
    const previous = camera.pointers.get(event.pointerId);
    camera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (camera.pointers.size >= 2) {
      const [first, second] = [...camera.pointers.values()];
      const nextDistance = distanceBetween(first, second);
      if (camera.pinchDistance > 0) {
        camera.zoom = clamp(camera.zoom * (nextDistance / camera.pinchDistance), 0.72, 1.55);
        setCameraStyle(board, camera);
      }
      camera.pinchDistance = nextDistance;
      camera.suppressClick = true;
      event.preventDefault();
      return;
    }

    const drag = camera.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
      drag.moved = true;
      try { board.setPointerCapture(event.pointerId); } catch {}
    }
    if (!drag.moved) return;

    camera.rotation = clamp(camera.rotation + (event.clientX - previous.x) * 0.48, -45, 45);
    camera.suppressClick = true;
    setCameraStyle(board, camera);
    event.preventDefault();
  });

  const finishPointer = (event) => {
    camera.pointers.delete(event.pointerId);
    if (camera.pointers.size < 2) camera.pinchDistance = 0;
    if (camera.drag?.pointerId === event.pointerId) camera.drag = null;
    if (camera.suppressClick) setTimeout(() => { camera.suppressClick = false; }, 0);
  };
  board.addEventListener("pointerup", finishPointer);
  board.addEventListener("pointercancel", finishPointer);

  board.addEventListener("wheel", (event) => {
    event.preventDefault();
    camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.001), 0.72, 1.55);
    setCameraStyle(board, camera);
  }, { passive: false });

  wrapper?.classList.add("board-camera-stage");
  window.addEventListener("resize", () => setCameraStyle(board, camera));
  return camera;
}

export function orientBoardForPlayer(board, color) {
  if (!board) return;
  board.dataset.bottomColor = color === "black" ? "black" : "white";
  initializeBoardCamera(board);
}
