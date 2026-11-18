const cameras = new WeakMap();

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function setCameraStyle(board, camera) {
  board.style.setProperty("--camera-orbit", `${camera.orbit}deg`);
  board.style.setProperty("--camera-tilt", `${camera.tilt}deg`);
  board.style.setProperty("--camera-zoom", camera.zoom.toFixed(3));
  board.style.setProperty("--camera-pan-x", `${camera.panX}px`);
  board.style.setProperty("--camera-pan-y", `${camera.panY}px`);
}

function resetCamera(board, camera) {
  camera.orbit = 0;
  camera.tilt = 39;
  camera.zoom = 1;
  camera.panX = 0;
  camera.panY = 0;
  setCameraStyle(board, camera);
}

function distanceBetween(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function initializeBoardCamera(board, wrapper = board?.parentElement) {
  if (!board) return null;
  if (cameras.has(board)) return cameras.get(board);

  const camera = {
    orbit: 0,
    tilt: 39,
    zoom: 1,
    panX: 0,
    panY: 0,
    pointers: new Map(),
    drag: null,
    pinchDistance: 0,
    pinchCenter: null,
    suppressClick: false,
  };
  cameras.set(board, camera);
  setCameraStyle(board, camera);

  const resetButton = document.querySelector("#camera-reset");
  resetButton?.addEventListener("click", () => resetCamera(board, camera));

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
      camera.pinchCenter = midpoint(first, second);
      camera.drag = null;
      return;
    }
    if (camera.pointers.size > 2) return;
    const pan = event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey);
    if (event.button === 0 || event.button === 1 || event.button === 2) {
      camera.drag = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        mode: pan ? "pan" : "orbit",
      };
    }
  });

  board.addEventListener("pointermove", (event) => {
    if (!camera.pointers.has(event.pointerId)) return;
    const previous = camera.pointers.get(event.pointerId);
    camera.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (camera.pointers.size >= 2) {
      const [first, second] = [...camera.pointers.values()];
      const nextDistance = distanceBetween(first, second);
      const nextCenter = midpoint(first, second);
      if (camera.pinchDistance > 0) {
        camera.zoom = clamp(camera.zoom * (nextDistance / camera.pinchDistance), 0.72, 1.72);
        camera.panX = clamp(camera.panX + nextCenter.x - camera.pinchCenter.x, -180, 180);
        camera.panY = clamp(camera.panY + nextCenter.y - camera.pinchCenter.y, -180, 180);
        setCameraStyle(board, camera);
      }
      camera.pinchDistance = nextDistance;
      camera.pinchCenter = nextCenter;
      camera.suppressClick = true;
      event.preventDefault();
      return;
    }

    const drag = camera.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) {
      drag.moved = true;
      try { board.setPointerCapture(event.pointerId); } catch {}
    }
    if (!drag.moved) return;
    camera.suppressClick = true;
    if (drag.mode === "pan") {
      camera.panX = clamp(camera.panX + deltaX, -180, 180);
      camera.panY = clamp(camera.panY + deltaY, -180, 180);
    } else {
      camera.orbit = ((camera.orbit + deltaX * 0.48 + 180) % 360 + 360) % 360 - 180;
      camera.tilt = clamp(camera.tilt + deltaY * 0.22, 29, 62);
    }
    setCameraStyle(board, camera);
    event.preventDefault();
  });

  const finishPointer = (event) => {
    camera.pointers.delete(event.pointerId);
    if (camera.pointers.size < 2) {
      camera.pinchDistance = 0;
      camera.pinchCenter = null;
    }
    if (camera.drag?.pointerId === event.pointerId) camera.drag = null;
    if (camera.suppressClick) {
      setTimeout(() => { camera.suppressClick = false; }, 0);
    }
  };
  board.addEventListener("pointerup", finishPointer);
  board.addEventListener("pointercancel", finishPointer);

  board.addEventListener("wheel", (event) => {
    event.preventDefault();
    camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.001), 0.72, 1.72);
    setCameraStyle(board, camera);
  }, { passive: false });

  wrapper?.classList.add("board-camera-stage");
  return camera;
}

export function orientBoardForPlayer(board, color) {
  if (!board) return;
  board.dataset.bottomColor = color === "black" ? "black" : "white";
  initializeBoardCamera(board);
}
