/**
 * Colormixer — Core Paint Mixing Algorithm
 *
 * Simulates subtractive paint mixing using a weighted geometric mean
 * in linear RGB space, optimized in CIELAB for perceptual accuracy.
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

  // ── Base paint palette ───────────────────────────────────────

  const BASE_PAINTS = [
    { name: 'Red',    hex: '#CD1916' },
    { name: 'Yellow', hex: '#FFD300' },
    { name: 'Blue',   hex: '#1A3A8A' },
    { name: 'White',  hex: '#F5F5F0' },
    { name: 'Black',  hex: '#1C1C1C' },
  ];

  let _init = false;
  function ensureInit() {
    if (_init) return;
    _init = true;
    BASE_PAINTS.forEach(p => {
      const rgb = chroma(p.hex).rgb();
      p.linear = [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
      p.lab = linearRgbToLab(p.linear);
    });
  }

  // ── Subtractive mixing model ─────────────────────────────────
  // Weighted geometric mean in linear RGB approximates subtractive
  // pigment mixing: darker pigments dominate, mixing darkens.

  const LOG_FLOOR = Math.log(0.0001);

  function mixLinear(ratios) {
    const result = [0, 0, 0];
    for (let ch = 0; ch < 3; ch++) {
      let logSum = 0;
      for (let i = 0; i < 5; i++) {
        if (ratios[i] <= 0) continue;
        const v = BASE_PAINTS[i].linear[ch];
        logSum += ratios[i] * (v > 0.0001 ? Math.log(v) : LOG_FLOOR);
      }
      result[ch] = Math.exp(logSum);
    }
    return result;
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
    const sum = ratios.reduce((s, v) => s + Math.max(0, v), 0);
    if (sum === 0) return [0, 0, 0, 1, 0];
    return ratios.map(v => Math.max(0, v) / sum);
  }

  // ── Heuristic initial guess ──────────────────────────────────

  function heuristicGuess(targetLab) {
    const L = targetLab[0];
    const a = targetLab[1];
    const b = targetLab[2];
    const C = Math.sqrt(a * a + b * b);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;

    const ratios = [0, 0, 0, 0, 0];

    const whiteness = Math.max(0, (L - 50) / 50);
    const blackness = Math.max(0, (50 - L) / 50);

    if (C < 10) {
      const wRatio = L / 100;
      ratios[3] = wRatio;
      ratios[4] = 1 - wRatio;
      return normalize(ratios);
    }

    let primary1, primary2, blend;
    if (hue < 60) {
      primary1 = 0; primary2 = 1;
      blend = hue / 60;
    } else if (hue < 180) {
      primary1 = 1; primary2 = 2;
      blend = (hue - 60) / 120;
    } else if (hue < 270) {
      primary1 = 2; primary2 = 0;
      blend = (hue - 180) / 90;
    } else {
      primary1 = 0; primary2 = 2;
      blend = 1 - (hue - 270) / 90;
    }

    const cw = Math.min(C / 80, 1);
    ratios[primary1] = cw * (1 - blend);
    ratios[primary2] = cw * blend;
    ratios[3] = whiteness * (1 - cw * 0.5);
    ratios[4] = blackness * (1 - cw * 0.5);

    return normalize(ratios);
  }

  // ── Broad grid search ────────────────────────────────────────

  function broadSearch(targetLab) {
    let bestRatios = null;
    let bestError = Infinity;
    const G = 10; // 10% steps

    // Scan all 1-, 2-, and 3-paint combinations
    for (let i = 0; i < 5; i++) {
      for (let j = i; j < 5; j++) {
        for (let k = j; k < 5; k++) {
          for (let a = 0; a <= G; a++) {
            for (let b = 0; b <= G - a; b++) {
              const c = G - a - b;
              const ratios = [0, 0, 0, 0, 0];
              ratios[i]  = a / G;
              ratios[j] += b / G;
              ratios[k] += c / G;
              const normed = normalize(ratios);
              const error = deltaE76(simulateMix(normed), targetLab);
              if (error < bestError) {
                bestError = error;
                bestRatios = normed;
              }
            }
          }
        }
      }
    }

    return bestRatios;
  }

  // ── Iterative refinement ─────────────────────────────────────

  function refineRatios(targetLab, initialRatios) {
    let best = [...initialRatios];
    let bestError = deltaE76(simulateMix(best), targetLab);

    let step = 0.10;
    let stagnant = 0;

    for (let iter = 0; iter < 80; iter++) {
      let improved = false;

      // Pairwise transfers
      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i === j) continue;
          const candidate = [...best];
          const shift = Math.min(step, candidate[j]);
          if (shift <= 0) continue;
          candidate[i] += shift;
          candidate[j] -= shift;
          const normed = normalize(candidate);
          const error = deltaE76(simulateMix(normed), targetLab);
          if (error < bestError - 0.0001) {
            best = normed;
            bestError = error;
            improved = true;
          }
        }
      }

      // Boost one paint at expense of all others
      for (let i = 0; i < 5; i++) {
        const candidate = [...best];
        for (let j = 0; j < 5; j++) {
          if (j !== i) candidate[j] *= (1 - step);
        }
        candidate[i] = Math.min(1, candidate[i] + step * (1 - candidate[i]));
        const normed = normalize(candidate);
        const error = deltaE76(simulateMix(normed), targetLab);
        if (error < bestError - 0.0001) {
          best = normed;
          bestError = error;
          improved = true;
        }
      }

      if (!improved) {
        stagnant++;
        step *= 0.6;
        if (step < 0.001 || stagnant > 5) break;
      } else {
        stagnant = 0;
      }
    }

    return best;
  }

  // ── Main entry ───────────────────────────────────────────────

  function findMix(targetHex) {
    ensureInit();
    const targetLab = chroma(targetHex).lab();

    // Phase 1: Heuristic guess
    const heuristic = heuristicGuess(targetLab);

    // Phase 2: Broad grid search
    const broad = broadSearch(targetLab);

    // Phase 3: Refine both candidates, keep the better one
    const refinedH = refineRatios(targetLab, heuristic);
    const refinedB = refineRatios(targetLab, broad);

    const errorH = deltaE76(simulateMix(refinedH), targetLab);
    const errorB = deltaE76(simulateMix(refinedB), targetLab);
    const refined = errorB < errorH ? refinedB : refinedH;

    // Round to whole percentages
    const rounded = roundRatios(refined);

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
