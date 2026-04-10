/**
 * Colormixer — Core Paint Mixing Algorithm
 *
 * Simulates subtractive paint mixing using Kubelka-Munk theory
 * (K/S absorption-scattering coefficients in linear RGB space),
 * optimized in CIELAB with Nelder-Mead + random restarts.
 */

const ColorMixer = (() => {
  // ── Color space conversions ──────────────────────────────────

  function srgbToLinear(c) {
    c = c / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    c = Math.max(0, Math.min(1, c));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(255, s * 255)));
  }

  const D65 = [0.95047, 1.0, 1.08883];

  function linearRgbToLab(lin) {
    const x = 0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2];
    const y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.0721750 * lin[2];
    const z = 0.0193339 * lin[0] + 0.1191920 * lin[1] + 0.9503041 * lin[2];

    function f(t) {
      return t > 0.008856 ? Math.cbrt(t) : (903.3 * t + 16) / 116;
    }
    const fx = f(x / D65[0]);
    const fy = f(y / D65[1]);
    const fz = f(z / D65[2]);

    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  function linearRgbToHex(lin) {
    const r = linearToSrgb(lin[0]);
    const g = linearToSrgb(lin[1]);
    const b = linearToSrgb(lin[2]);
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  // ── Kubelka-Munk K/S model ──────────────────────────────────
  // K/S = (1 - R)^2 / (2R)  where R is reflectance per channel.
  // Mix K/S linearly by weight, then invert back to reflectance.

  function rgbToKS(linearRGB) {
    return linearRGB.map(r => {
      const R = Math.max(r, 0.001);
      return (1 - R) ** 2 / (2 * R);
    });
  }

  function ksToReflectance(ks) {
    return ks.map(v => {
      const R = 1 + v - Math.sqrt(v * v + 2 * v);
      return Math.max(0, Math.min(1, R));
    });
  }

  // ── Base paint palette (8 artist paints) ─────────────────────

  const BASE_PAINTS = [
    { name: 'Cad Red',      hex: '#C8372D' },
    { name: 'Cad Yellow',   hex: '#F5C518' },
    { name: 'Ultramarine',  hex: '#2E3F9E' },
    { name: 'Phthalo Blue', hex: '#1B6B93' },
    { name: 'Quin Magenta', hex: '#8E2344' },
    { name: 'Burnt Sienna', hex: '#8A4513' },
    { name: 'White',        hex: '#F8F8F6' },
    { name: 'Black',        hex: '#1A1A18' },
  ];

  const NUM_PAINTS = BASE_PAINTS.length;

  let _init = false;
  function ensureInit() {
    if (_init) return;
    _init = true;
    BASE_PAINTS.forEach(p => {
      const rgb = chroma(p.hex).rgb();
      p.linear = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
      p.lab = linearRgbToLab(p.linear);
      p.ks = rgbToKS(p.linear);
    });
  }

  // ── Subtractive mixing (Kubelka-Munk) ───────────────────────

  function mixKS(ratios) {
    const ks = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      for (let i = 0; i < NUM_PAINTS; i++) {
        if (ratios[i] <= 0) continue;
        ks[ch] += ratios[i] * BASE_PAINTS[i].ks[ch];
      }
    }
    return ks;
  }

  function mixLinear(ratios) {
    return ksToReflectance(mixKS(ratios));
  }

  function simulateMix(ratios) {
    return linearRgbToLab(mixLinear(ratios));
  }

  // ── Delta E ──────────────────────────────────────────────────

  function deltaE76(lab1, lab2) {
    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  function deltaE2000(hex1, hex2) {
    return chroma.deltaE(hex1, hex2);
  }

  // ── Normalize ────────────────────────────────────────────────

  function normalize(ratios) {
    const clamped = ratios.map(v => Math.max(0, v));
    const sum = clamped.reduce((s, v) => s + v, 0);
    if (sum === 0) {
      const result = new Array(NUM_PAINTS).fill(0);
      result[NUM_PAINTS - 2] = 1; // default to white
      return result;
    }
    return clamped.map(v => v / sum);
  }

  // ── Heuristic initial guess ──────────────────────────────────
  // Maps target LAB color to a reasonable starting paint mix.
  // Indices: 0=CadRed, 1=CadYellow, 2=Ultramarine, 3=PhthaloBl,
  //          4=QuinMag, 5=BurntSienna, 6=White, 7=Black

  function heuristicGuess(targetLab) {
    const L = targetLab[0];
    const a = targetLab[1];
    const b = targetLab[2];
    const C = Math.sqrt(a * a + b * b);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;

    const ratios = new Array(NUM_PAINTS).fill(0);

    const whiteness = Math.max(0, (L - 50) / 50);
    const blackness = Math.max(0, (50 - L) / 50);

    if (C < 10) {
      // Neutral / gray: white + black, with burnt sienna for warm bias
      ratios[6] = L / 100;
      ratios[7] = 1 - L / 100;
      if (b > 2) ratios[5] = 0.1;
      return normalize(ratios);
    }

    // Map hue angle to primary paint pairs
    let primary1, primary2, blend;

    if (hue < 30) {
      primary1 = 0; primary2 = 4; // Cad Red ← Quin Magenta
      blend = hue / 30;
    } else if (hue < 70) {
      primary1 = 0; primary2 = 1; // Cad Red → Cad Yellow
      blend = (hue - 30) / 40;
    } else if (hue < 150) {
      primary1 = 1; primary2 = 3; // Cad Yellow → Phthalo Blue
      blend = (hue - 70) / 80;
    } else if (hue < 210) {
      primary1 = 3; primary2 = 2; // Phthalo Blue → Ultramarine
      blend = (hue - 150) / 60;
    } else if (hue < 270) {
      primary1 = 2; primary2 = 4; // Ultramarine → Quin Magenta
      blend = (hue - 210) / 60;
    } else if (hue < 330) {
      primary1 = 4; primary2 = 0; // Quin Magenta → Cad Red
      blend = (hue - 270) / 60;
    } else {
      primary1 = 0; primary2 = 4; // Cad Red ← Quin Magenta
      blend = (360 - hue) / 30;
    }

    const cw = Math.min(C / 80, 1);
    ratios[primary1] = cw * (1 - blend);
    ratios[primary2] = cw * blend;

    // Brown / earth tones get burnt sienna boost
    if (C < 50 && hue > 15 && hue < 65 && L < 55) {
      ratios[5] = cw * 0.4;
    }

    ratios[6] = whiteness * (1 - cw * 0.5);
    ratios[7] = blackness * (1 - cw * 0.5);

    return normalize(ratios);
  }

  // ── Nelder-Mead simplex optimizer ────────────────────────────
  // Derivative-free optimization on the paint-ratio simplex.

  function nelderMead(targetLab, startRatios, maxIter) {
    maxIter = maxIter || 250;
    const n = NUM_PAINTS;

    function objective(ratios) {
      return deltaE76(simulateMix(normalize(ratios)), targetLab);
    }

    // Build initial simplex: start point + n perturbations
    const simplex = [];
    const start = normalize(startRatios);
    simplex.push({ x: start, f: objective(start) });

    for (let i = 0; i < n; i++) {
      const point = [...start];
      point[i] = Math.min(1, point[i] + 0.15);
      const normed = normalize(point);
      simplex.push({ x: normed, f: objective(normed) });
    }

    for (let iter = 0; iter < maxIter; iter++) {
      // Sort: best first
      simplex.sort((a, b) => a.f - b.f);

      // Convergence checks
      if (simplex[0].f < 0.3) break;
      if (simplex[n].f - simplex[0].f < 0.0005) break;

      // Centroid of all points except worst
      const centroid = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          centroid[j] += simplex[i].x[j];
        }
      }
      for (let j = 0; j < n; j++) centroid[j] /= n;

      const worst = simplex[n];

      // Reflection (alpha = 1)
      const reflected = normalize(centroid.map((c, j) => c + (c - worst.x[j])));
      const rF = objective(reflected);

      if (rF < simplex[n - 1].f && rF >= simplex[0].f) {
        simplex[n] = { x: reflected, f: rF };
        continue;
      }

      if (rF < simplex[0].f) {
        // Expansion (gamma = 2)
        const expanded = normalize(centroid.map((c, j) => c + 2 * (reflected[j] - c)));
        const eF = objective(expanded);
        simplex[n] = eF < rF ? { x: expanded, f: eF } : { x: reflected, f: rF };
        continue;
      }

      // Contraction (rho = 0.5)
      const contracted = normalize(centroid.map((c, j) => c + 0.5 * (worst.x[j] - c)));
      const cF = objective(contracted);

      if (cF < worst.f) {
        simplex[n] = { x: contracted, f: cF };
        continue;
      }

      // Shrink (sigma = 0.5)
      const best = simplex[0];
      for (let i = 1; i <= n; i++) {
        const shrunk = normalize(best.x.map((bv, j) => bv + 0.5 * (simplex[i].x[j] - bv)));
        simplex[i] = { x: shrunk, f: objective(shrunk) };
      }
    }

    simplex.sort((a, b) => a.f - b.f);
    return normalize(simplex[0].x);
  }

  // ── Random starting points ───────────────────────────────────

  function randomDirichlet(n) {
    const vals = [];
    for (let i = 0; i < n; i++) {
      vals.push(-Math.log(Math.random() + 1e-10));
    }
    const sum = vals.reduce((s, v) => s + v, 0);
    return vals.map(v => v / sum);
  }

  function randomSparse(n) {
    const ratios = new Array(n).fill(0);
    const numActive = 1 + Math.floor(Math.random() * 3);
    const indices = [];
    while (indices.length < numActive) {
      const idx = Math.floor(Math.random() * n);
      if (!indices.includes(idx)) indices.push(idx);
    }
    for (const idx of indices) {
      ratios[idx] = Math.random();
    }
    return normalize(ratios);
  }

  // ── Main entry ───────────────────────────────────────────────

  function findMix(targetHex) {
    ensureInit();
    const targetLab = chroma(targetHex).lab();

    const candidates = [];

    // Candidate 1: Heuristic guess based on hue/lightness
    candidates.push(heuristicGuess(targetLab));

    // Candidate 2: Nearest single paint
    let bestSingle = 0, bestSingleErr = Infinity;
    for (let i = 0; i < NUM_PAINTS; i++) {
      const err = deltaE76(BASE_PAINTS[i].lab, targetLab);
      if (err < bestSingleErr) { bestSingleErr = err; bestSingle = i; }
    }
    const singleStart = new Array(NUM_PAINTS).fill(0);
    singleStart[bestSingle] = 1;
    candidates.push(singleStart);

    // Candidates 3+: Random restarts (Dirichlet spread + sparse 1-3 paint)
    for (let i = 0; i < 20; i++) {
      candidates.push(i < 10 ? randomDirichlet(NUM_PAINTS) : randomSparse(NUM_PAINTS));
    }

    // Run Nelder-Mead on each, keep the best
    let bestRatios = null;
    let bestError = Infinity;

    for (const start of candidates) {
      const refined = nelderMead(targetLab, start);
      const error = deltaE76(simulateMix(refined), targetLab);
      if (error < bestError) {
        bestError = error;
        bestRatios = refined;
      }
    }

    // Round to whole percentages
    const rounded = roundRatios(bestRatios);

    // Compute final mixed color
    const mixedHex = linearRgbToHex(mixLinear(rounded));
    const dE = deltaE2000(targetHex, mixedHex);
    const accuracy = getAccuracyLabel(dE);

    // Build paint list (only paints with > 0%)
    const paints = BASE_PAINTS.map((p, i) => ({
      name: p.name,
      hex: p.hex,
      ratio: rounded[i],
      percent: Math.round(rounded[i] * 100),
    })).filter(p => p.percent > 0)
      .sort((a, b) => b.percent - a.percent);

    return {
      paints,
      mixedHex,
      targetHex,
      deltaE: Math.round(dE * 10) / 10,
      accuracy,
      instructions: generateInstructions(paints),
    };
  }

  // ── Round ratios ─────────────────────────────────────────────

  function roundRatios(ratios) {
    const percents = ratios.map(r => Math.round(r * 100));
    let sum = percents.reduce((s, v) => s + v, 0);

    while (sum > 100) {
      const maxIdx = percents.indexOf(Math.max(...percents));
      percents[maxIdx]--;
      sum--;
    }
    while (sum < 100) {
      let bestIdx = 0;
      let bestDiff = -Infinity;
      for (let i = 0; i < ratios.length; i++) {
        const diff = ratios[i] * 100 - percents[i];
        if (diff > bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      percents[bestIdx]++;
      sum++;
    }

    return percents.map(p => p / 100);
  }

  // ── Accuracy label ───────────────────────────────────────────

  function getAccuracyLabel(dE) {
    if (dE < 1)  return { text: 'Excellent — nearly identical', level: 'excellent' };
    if (dE < 3)  return { text: 'Very close match', level: 'good' };
    if (dE < 5)  return { text: 'Close match', level: 'fair' };
    if (dE < 10) return { text: 'Approximate match', level: 'rough' };
    return { text: 'Rough approximation', level: 'poor' };
  }

  // ── Instructions ─────────────────────────────────────────────

  function generateInstructions(paints) {
    if (paints.length === 0) return [];

    const sorted = [...paints].sort((a, b) => b.percent - a.percent);
    const instructions = [];

    instructions.push(
      `Start with ${sorted[0].name} as your base — this is the dominant color (${sorted[0].percent}%).`
    );

    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i];
      let verb;
      if (p.percent >= 20) verb = `Mix in ${p.name} gradually`;
      else if (p.percent >= 10) verb = `Add ${p.name} in small amounts`;
      else if (p.percent >= 5) verb = `Add a small touch of ${p.name}`;
      else verb = `Add a tiny amount of ${p.name}`;
      instructions.push(`${verb} (${p.percent}%).`);
    }

    instructions.push(
      'Tip: Always add darker colors to lighter ones in small increments — you can add more but can\'t take it back.'
    );

    return instructions;
  }

  // ── Public API ───────────────────────────────────────────────

  return {
    findMix,
    BASE_PAINTS,
    simulateMix,
    deltaE2000,
  };
})();
