/**
 * Colormixer — Core Paint Mixing Algorithm
 *
 * Finds the best combination of 5 base artist paints to approximate
 * a target digital color. Works in CIELAB space for perceptual accuracy.
 */

const ColorMixer = (() => {
  // Base artist paint palette with approximate LAB values
  const BASE_PAINTS = [
    { name: 'Red',    hex: '#CD1916', lab: [47, 67, 55]  },
    { name: 'Yellow', hex: '#FFD300', lab: [87, 3, 87]    },
    { name: 'Blue',   hex: '#1A3A8A', lab: [27, 25, -60]  },
    { name: 'White',  hex: '#F5F5F0', lab: [97, 0, 2]     },
    { name: 'Black',  hex: '#1C1C1C', lab: [12, 0, 0]     },
  ];

  /**
   * Simulate mixing paints by weighted average in LAB space.
   * This is a simplification of subtractive mixing but works
   * reasonably well for an MVP approximation.
   */
  function simulateMix(ratios) {
    let L = 0, a = 0, b = 0;
    for (let i = 0; i < BASE_PAINTS.length; i++) {
      L += ratios[i] * BASE_PAINTS[i].lab[0];
      a += ratios[i] * BASE_PAINTS[i].lab[1];
      b += ratios[i] * BASE_PAINTS[i].lab[2];
    }
    return [L, a, b];
  }

  /**
   * Compute Delta E (CIE76) between two LAB colors.
   * Simple Euclidean distance — sufficient for MVP ranking.
   */
  function deltaE76(lab1, lab2) {
    const dL = lab1[0] - lab2[0];
    const da = lab1[1] - lab2[1];
    const db = lab1[2] - lab2[2];
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /**
   * Compute Delta E (CIE2000) using chroma.js for display accuracy.
   */
  function deltaE2000(hex1, hex2) {
    return chroma.deltaE(hex1, hex2);
  }

  /**
   * Generate a heuristic initial guess based on the target color's
   * lightness, hue, and chroma in LCH space.
   */
  function heuristicGuess(targetLab) {
    const L = targetLab[0];
    const a = targetLab[1];
    const b = targetLab[2];
    const C = Math.sqrt(a * a + b * b);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;

    let ratios = [0, 0, 0, 0, 0]; // [red, yellow, blue, white, black]

    // Lightness: determine white/black contribution
    const whiteness = Math.max(0, (L - 50) / 50);
    const blackness = Math.max(0, (50 - L) / 50);

    // If very low chroma, it's mostly achromatic
    if (C < 10) {
      const wRatio = L / 100;
      ratios[3] = wRatio;       // white
      ratios[4] = 1 - wRatio;   // black
      return normalize(ratios);
    }

    // Hue-based primary selection
    let primary1, primary2, blend;

    if (hue >= 0 && hue < 60) {
      // Red to Yellow
      primary1 = 0; primary2 = 1;
      blend = hue / 60;
    } else if (hue >= 60 && hue < 180) {
      // Yellow to Blue (through green)
      primary1 = 1; primary2 = 2;
      blend = (hue - 60) / 120;
    } else if (hue >= 180 && hue < 270) {
      // Blue to Red (through purple)
      primary1 = 2; primary2 = 0;
      blend = (hue - 180) / 90;
    } else {
      // Red (through magenta) — 270-360
      primary1 = 0; primary2 = 2;
      blend = 1 - (hue - 270) / 90;
    }

    const chromaWeight = Math.min(C / 80, 1);
    ratios[primary1] = chromaWeight * (1 - blend);
    ratios[primary2] = chromaWeight * blend;
    ratios[3] = whiteness * (1 - chromaWeight * 0.5);
    ratios[4] = blackness * (1 - chromaWeight * 0.5);

    return normalize(ratios);
  }

  /** Normalize ratios to sum to 1 */
  function normalize(ratios) {
    const sum = ratios.reduce((s, v) => s + Math.max(0, v), 0);
    if (sum === 0) return [0, 0, 0, 1, 0]; // default to white
    return ratios.map(v => Math.max(0, v) / sum);
  }

  /**
   * Grid search refinement around the heuristic guess.
   * Tests variations of each ratio and keeps the best.
   */
  function refineRatios(targetLab, initialRatios, iterations) {
    let best = [...initialRatios];
    let bestError = deltaE76(simulateMix(best), targetLab);

    const steps = [0.15, 0.08, 0.04, 0.02, 0.01];

    for (let iter = 0; iter < iterations; iter++) {
      const step = steps[Math.min(iter, steps.length - 1)];
      let improved = false;

      for (let i = 0; i < 5; i++) {
        for (let j = 0; j < 5; j++) {
          if (i === j) continue;

          // Try shifting weight from paint j to paint i
          const candidate = [...best];
          const shift = Math.min(step, candidate[j]);
          candidate[i] += shift;
          candidate[j] -= shift;

          if (candidate[i] < 0 || candidate[j] < 0) continue;

          const error = deltaE76(simulateMix(candidate), targetLab);
          if (error < bestError) {
            best = normalize(candidate);
            bestError = error;
            improved = true;
          }
        }
      }

      // Also try adding each paint at the expense of all others
      for (let i = 0; i < 5; i++) {
        const candidate = [...best];
        for (let j = 0; j < 5; j++) {
          if (j !== i) candidate[j] *= (1 - step);
        }
        candidate[i] += step * (1 - candidate[i]);
        const normed = normalize(candidate);
        const error = deltaE76(simulateMix(normed), targetLab);
        if (error < bestError) {
          best = normed;
          bestError = error;
          improved = true;
        }
      }

      if (!improved && iter > 2) break;
    }

    return best;
  }

  /**
   * Broad search: test many starting points across the ratio space.
   */
  function broadSearch(targetLab) {
    let bestRatios = null;
    let bestError = Infinity;

    // Generate candidate starting points
    const granularity = 5; // steps of 20%
    const candidates = [];

    // Systematic scan of 2-paint and 3-paint combinations
    for (let i = 0; i < 5; i++) {
      for (let j = i; j < 5; j++) {
        for (let k = j; k < 5; k++) {
          for (let a = 0; a <= granularity; a++) {
            for (let b = 0; b <= granularity - a; b++) {
              const c = granularity - a - b;
              const ratios = [0, 0, 0, 0, 0];
              ratios[i] = a / granularity;
              ratios[j] += b / granularity;
              ratios[k] += c / granularity;
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

  /**
   * Main entry: find the best paint mix for a target hex color.
   * Returns { ratios, paints, mixedHex, targetHex, deltaE, accuracy }
   */
  function findMix(targetHex) {
    const targetLab = chroma(targetHex).lab();

    // Phase 1: Heuristic guess
    const heuristic = heuristicGuess(targetLab);

    // Phase 2: Broad grid search
    const broad = broadSearch(targetLab);

    // Phase 3: Refine best candidate
    const heuristicError = deltaE76(simulateMix(heuristic), targetLab);
    const broadError = deltaE76(simulateMix(broad), targetLab);
    const startRatios = broadError < heuristicError ? broad : heuristic;
    const refined = refineRatios(targetLab, startRatios, 20);

    // Round to whole percentages
    const rounded = roundRatios(refined);

    // Compute final mixed color
    const mixedLab = simulateMix(rounded);
    let mixedHex;
    try {
      mixedHex = chroma.lab(...mixedLab).hex();
    } catch {
      mixedHex = chroma.lab(
        Math.max(0, Math.min(100, mixedLab[0])),
        Math.max(-128, Math.min(127, mixedLab[1])),
        Math.max(-128, Math.min(127, mixedLab[2]))
      ).hex();
    }

    const dE = deltaE2000(targetHex, mixedHex);
    const accuracy = getAccuracyLabel(dE);

    // Build paint list with ratios > 0
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

  /** Round ratios to whole percentages that sum to 100% */
  function roundRatios(ratios) {
    let percents = ratios.map(r => Math.round(r * 100));
    let sum = percents.reduce((s, v) => s + v, 0);

    // Adjust rounding errors
    while (sum > 100) {
      const maxIdx = percents.indexOf(Math.max(...percents));
      percents[maxIdx]--;
      sum--;
    }
    while (sum < 100) {
      // Find the ratio with the largest rounding error
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

  function getAccuracyLabel(dE) {
    if (dE < 1)  return { text: 'Excellent — nearly identical', level: 'excellent' };
    if (dE < 3)  return { text: 'Very close match', level: 'good' };
    if (dE < 5)  return { text: 'Close match', level: 'fair' };
    if (dE < 10) return { text: 'Approximate match', level: 'rough' };
    return { text: 'Rough approximation', level: 'poor' };
  }

  /** Generate human-readable mixing instructions */
  function generateInstructions(paints) {
    if (paints.length === 0) return [];

    const instructions = [];
    const sorted = [...paints].sort((a, b) => b.percent - a.percent);

    // Step 1: Start with the largest amount
    instructions.push(
      `Start with ${sorted[0].name} as your base — this is the dominant color (${sorted[0].percent}%).`
    );

    // Subsequent paints
    for (let i = 1; i < sorted.length; i++) {
      const p = sorted[i];
      let verb;
      if (p.percent >= 20) {
        verb = `Mix in ${p.name} gradually`;
      } else if (p.percent >= 10) {
        verb = `Add ${p.name} in small amounts`;
      } else if (p.percent >= 5) {
        verb = `Add a small touch of ${p.name}`;
      } else {
        verb = `Add a tiny amount of ${p.name}`;
      }
      instructions.push(`${verb} (${p.percent}%).`);
    }

    // Tip
    instructions.push(
      'Tip: Always add darker colors to lighter ones in small increments — you can add more but can\'t take it back.'
    );

    return instructions;
  }

  // Public API
  return {
    findMix,
    BASE_PAINTS,
    simulateMix,
    deltaE2000,
  };
})();
