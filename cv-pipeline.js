const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function orderCorners(points) {
  if (!points || points.length !== 4) return null;
  const sums = points.map(({ x, y }) => x + y);
  const diffs = points.map(({ x, y }) => x - y);
  return [
    points[sums.indexOf(Math.min(...sums))],
    points[diffs.indexOf(Math.max(...diffs))],
    points[sums.indexOf(Math.max(...sums))],
    points[diffs.indexOf(Math.min(...diffs))],
  ];
}

function rightAngleScore(points) {
  const ordered = orderCorners(points);
  if (!ordered) return 0;
  let worstCosine = 0;
  for (let index = 0; index < 4; index += 1) {
    const previous = ordered[(index + 3) % 4];
    const current = ordered[index];
    const next = ordered[(index + 1) % 4];
    const ax = previous.x - current.x;
    const ay = previous.y - current.y;
    const bx = next.x - current.x;
    const by = next.y - current.y;
    const denominator = Math.hypot(ax, ay) * Math.hypot(bx, by);
    if (!denominator) return 0;
    worstCosine = Math.max(worstCosine, Math.abs((ax * bx + ay * by) / denominator));
  }
  return 1 - Math.min(1, worstCosine);
}

function pointsFromMat(mat) {
  return Array.from({ length: mat.rows }, (_, index) => ({
    x: mat.intPtr(index, 0)[0],
    y: mat.intPtr(index, 0)[1],
  }));
}

// A low-contrast white ID may expose only a colored security band. When that
// narrow band is the strongest contour, extrapolate the surrounding card in
// the direction of the frame center instead of cropping to the band itself.
function expandInnerBand(points, frameWidth, frameHeight) {
  const ordered = orderCorners(points);
  if (!ordered) return null;
  const [tl, tr, br, bl] = ordered;
  const topLength = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const bottomLength = Math.hypot(br.x - bl.x, br.y - bl.y);
  const leftLength = Math.hypot(bl.x - tl.x, bl.y - tl.y);
  const rightLength = Math.hypot(br.x - tr.x, br.y - tr.y);
  const longLength = (topLength + bottomLength) / 2;
  const shortLength = (leftLength + rightLength) / 2;
  if (longLength / Math.max(1, shortLength) < 2.15) return null;

  const topMid = { x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 };
  const bottomMid = { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 };
  const shortX = (bottomMid.x - topMid.x) / Math.max(1, shortLength);
  const shortY = (bottomMid.y - topMid.y) / Math.max(1, shortLength);
  const longX = ((tr.x - tl.x) + (br.x - bl.x)) / Math.max(1, topLength + bottomLength);
  const longY = ((tr.y - tl.y) + (br.y - bl.y)) / Math.max(1, topLength + bottomLength);
  const center = { x: (topMid.x + bottomMid.x) / 2, y: (topMid.y + bottomMid.y) / 2 };
  const towardFrameCenter = ((frameWidth / 2 - center.x) * shortX + (frameHeight / 2 - center.y) * shortY) >= 0 ? 1 : -1;
  const interior = shortLength * 2.7;
  const exterior = shortLength * 0.25;
  const sidePadding = longLength * 0.12;
  const topExtension = towardFrameCenter < 0 ? interior : exterior;
  const bottomExtension = towardFrameCenter > 0 ? interior : exterior;

  return [
    { x: tl.x - shortX * topExtension - longX * sidePadding, y: tl.y - shortY * topExtension - longY * sidePadding },
    { x: tr.x - shortX * topExtension + longX * sidePadding, y: tr.y - shortY * topExtension + longY * sidePadding },
    { x: br.x + shortX * bottomExtension + longX * sidePadding, y: br.y + shortY * bottomExtension + longY * sidePadding },
    { x: bl.x + shortX * bottomExtension - longX * sidePadding, y: bl.y + shortY * bottomExtension - longY * sidePadding },
  ].map(({ x, y }) => ({
    x: clamp(x, 0, frameWidth - 1),
    y: clamp(y, 0, frameHeight - 1),
  }));
}

export function documentLabel(points) {
  const ordered = orderCorners(points);
  if (!ordered) return 'Looking for a document...';
  const [tl, tr, br, bl] = ordered;
  const width = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
  const height = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  return ratio >= 1.48 && ratio <= 1.76 ? 'ID card detected' : 'Document detected';
}

export function findDocument(canvas) {
  if (!globalThis.cv?.Mat || canvas.width < 2) return null;
  const mats = [];
  try {
    const source = cv.imread(canvas); mats.push(source);
    const gray = new cv.Mat(); mats.push(gray);
    const blurred = new cv.Mat(); mats.push(blurred);
    const edges = new cv.Mat(); mats.push(edges);
    const closed = new cv.Mat(); mats.push(closed);
    const threshold = new cv.Mat(); mats.push(threshold);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)); mats.push(kernel);

    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 40, 140);
    cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
    cv.adaptiveThreshold(blurred, threshold, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 7);

    let best = null;
    let bestScore = 0;
    const frameArea = canvas.width * canvas.height;

    for (const mask of [closed, threshold]) {
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      try {
        cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        for (let index = 0; index < contours.size(); index += 1) {
          const contour = contours.get(index);
          try {
            const contourArea = Math.abs(cv.contourArea(contour));
            if (contourArea < frameArea * 0.025 || contourArea > frameArea * 0.94) continue;
            const perimeter = cv.arcLength(contour, true);

            for (const epsilon of [0.018, 0.025, 0.035, 0.05]) {
              const approx = new cv.Mat();
              try {
                cv.approxPolyDP(contour, approx, epsilon * perimeter, true);
                if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
                const points = pointsFromMat(approx);
                const angleScore = rightAngleScore(points);
                if (angleScore < 0.32) continue;
                const area = Math.abs(cv.contourArea(approx));
                const score = area * (0.6 + angleScore * 0.4);
                if (score > bestScore) {
                  bestScore = score;
                  best = points;
                }
              } finally {
                approx.delete();
              }
            }
          } finally {
            contour.delete();
          }
        }
      } finally {
        contours.delete();
        hierarchy.delete();
      }
    }

    let documentType = null;
    if (bestScore < frameArea * 0.18) {
      const expanded = expandInnerBand(best, canvas.width, canvas.height);
      if (expanded) {
        best = expanded;
        documentType = 'id';
      }
    }
    const result = orderCorners(best);
    if (result && documentType) Object.defineProperty(result, 'documentType', { value: documentType });
    return result;
  } catch (error) {
    console.warn('Document detection failed', error);
    return null;
  } finally {
    mats.reverse().forEach((mat) => mat.delete());
  }
}

function fallbackCorners(width, height) {
  const insetX = width * 0.06;
  const insetY = height * 0.06;
  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY },
  ];
}

export function perspectiveCrop(sourceCanvas, corners) {
  const ordered = orderCorners(corners) || fallbackCorners(sourceCanvas.width, sourceCanvas.height);
  if (!globalThis.cv?.Mat) return simpleCrop(sourceCanvas, ordered);
  const [tl, tr, br, bl] = ordered;
  const width = Math.round(Math.max(Math.hypot(br.x - bl.x, br.y - bl.y), Math.hypot(tr.x - tl.x, tr.y - tl.y)));
  const height = Math.round(Math.max(Math.hypot(tr.x - br.x, tr.y - br.y), Math.hypot(tl.x - bl.x, tl.y - bl.y)));
  const safeWidth = clamp(width, 1, 4096);
  const safeHeight = clamp(height, 1, 4096);
  const source = cv.imread(sourceCanvas);
  const target = new cv.Mat();
  const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, ordered.flatMap(({ x, y }) => [x, y]));
  const targetPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, safeWidth, 0, safeWidth, safeHeight, 0, safeHeight]);
  const transform = cv.getPerspectiveTransform(sourcePoints, targetPoints);
  try {
    cv.warpPerspective(source, target, transform, new cv.Size(safeWidth, safeHeight), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    const output = document.createElement('canvas');
    cv.imshow(output, target);
    return output;
  } finally {
    source.delete();
    target.delete();
    sourcePoints.delete();
    targetPoints.delete();
    transform.delete();
  }
}

function simpleCrop(source, corners) {
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const x = Math.max(0, Math.min(...xs));
  const y = Math.max(0, Math.min(...ys));
  const width = Math.min(source.width - x, Math.max(...xs) - x);
  const height = Math.min(source.height - y, Math.max(...ys) - y);
  const output = document.createElement('canvas');
  output.width = Math.max(1, width);
  output.height = Math.max(1, height);
  output.getContext('2d').drawImage(source, x, y, width, height, 0, 0, width, height);
  return output;
}

export function renderFilter(sourceCanvas, targetCanvas, filter) {
  targetCanvas.width = sourceCanvas.width;
  targetCanvas.height = sourceCanvas.height;
  const context = targetCanvas.getContext('2d', { willReadFrequently: true });
  context.filter = filter === 'gray' ? 'grayscale(1) contrast(1.08)' : 'none';
  context.drawImage(sourceCanvas, 0, 0);
  context.filter = 'none';
  if (filter !== 'bw') return;

  if (globalThis.cv?.Mat) {
    const source = cv.imread(targetCanvas);
    const gray = new cv.Mat();
    const output = new cv.Mat();
    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.adaptiveThreshold(gray, output, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 21, 12);
      cv.imshow(targetCanvas, output);
    } finally {
      source.delete();
      gray.delete();
      output.delete();
    }
  } else {
    const image = context.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const value = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114 > 150 ? 255 : 0;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = value;
    }
    context.putImageData(image, 0, 0);
  }
}
