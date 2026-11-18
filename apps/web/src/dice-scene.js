const faceRotations = {
  1: [0, 0],
  2: [0, -90],
  3: [90, 0],
  4: [-90, 0],
  5: [0, 90],
  6: [0, 180],
};

function transformForFace(face) {
  const [x, y] = faceRotations[face];
  return `rotateX(${x}deg) rotateY(${y}deg)`;
}

function numberFromFace(value) {
  const face = Number(value);
  return Number.isInteger(face) && face >= 1 && face <= 6 ? face : null;
}

/**
 * Adds a visual roll animation to the CSS 3D die. The result is never chosen
 * here: callers must pass the face returned by the game server to `land`.
 */
export function createDieAnimator(cube) {
  let currentFace = numberFromFace(cube?.dataset.currentFace);
  let rolling = false;
  let landTimer = 0;
  let pendingResolve = null;

  if (!cube) {
    return {
      startRoll() {},
      land() {},
      rollTo() { return Promise.resolve(); },
      showFace() {},
      reset() {},
    };
  }

  function clearTimer() {
    if (landTimer) clearTimeout(landTimer);
    landTimer = 0;
    if (pendingResolve) {
      pendingResolve();
      pendingResolve = null;
    }
  }

  function startRoll() {
    if (rolling) return;
    clearTimer();

    const [startX, startY] = faceRotations[currentFace] ?? [0, 0];
    cube.style.animation = "";
    cube.style.transition = "none";
    cube.style.transform = "";
    cube.style.setProperty("--die-start-x", `${startX}deg`);
    cube.style.setProperty("--die-start-y", `${startY}deg`);
    cube.style.setProperty("--die-spin-x", `${startX + 1080}deg`);
    cube.style.setProperty("--die-spin-y", `${startY - 720}deg`);
    cube.classList.add("is-rolling");
    rolling = true;
  }

  function land(value) {
    const face = numberFromFace(value);
    if (!face) return;
    clearTimer();

    if (!rolling) startRoll();
    const inFlightTransform = getComputedStyle(cube).transform;
    cube.classList.remove("is-rolling");
    cube.style.animation = "none";
    cube.style.transition = "none";
    cube.style.transform = inFlightTransform;
    cube.dataset.currentFace = String(face);
    cube.dataset.resultFace = String(face);
    rolling = false;

    // Commit the in-flight transform first, then transition to the server's
    // result so the cube visibly settles instead of snapping between faces.
    void cube.getBoundingClientRect();
    requestAnimationFrame(() => {
      cube.style.animation = "";
      cube.style.transition = "transform 680ms cubic-bezier(.17,.82,.22,1)";
      cube.style.transform = transformForFace(face);
      cube.style.removeProperty("--die-start-x");
      cube.style.removeProperty("--die-start-y");
      cube.style.removeProperty("--die-spin-x");
      cube.style.removeProperty("--die-spin-y");
    });
  }

  function rollTo(value, duration = 900) {
    const face = numberFromFace(value);
    if (!face) return Promise.resolve();
    clearTimer();
    startRoll();
    return new Promise((resolve) => {
      pendingResolve = resolve;
      landTimer = setTimeout(() => {
        landTimer = 0;
        pendingResolve = null;
        land(face);
        resolve();
      }, Math.max(0, duration));
    });
  }

  function reset() {
    clearTimer();
    rolling = false;
    currentFace = null;
    cube.classList.remove("is-rolling");
    cube.style.animation = "";
    cube.style.transition = "";
    cube.style.transform = "";
    cube.style.removeProperty("--die-start-x");
    cube.style.removeProperty("--die-start-y");
    cube.style.removeProperty("--die-spin-x");
    cube.style.removeProperty("--die-spin-y");
    delete cube.dataset.currentFace;
    delete cube.dataset.resultFace;
  }

  function showFace(value) {
    const face = numberFromFace(value);
    if (!face) return;
    clearTimer();
    rolling = false;
    cube.classList.remove("is-rolling");
    cube.style.animation = "none";
    cube.style.transition = "none";
    cube.style.transform = transformForFace(face);
    cube.dataset.currentFace = String(face);
    cube.dataset.resultFace = String(face);
    cube.setAttribute("aria-label", `Die shows ${face}`);
    currentFace = face;
    void cube.getBoundingClientRect();
    requestAnimationFrame(() => {
      cube.style.animation = "";
      cube.style.transition = "";
    });
  }

  return {
    startRoll,
    land(value) {
      land(value);
      currentFace = numberFromFace(value) ?? currentFace;
    },
    rollTo(value, duration) {
      return rollTo(value, duration).then(() => {
        currentFace = numberFromFace(value) ?? currentFace;
      });
    },
    showFace,
    reset,
  };
}
