/**
 * Colormixer — UI Logic
 *
 * Handles input synchronization, event binding, and rendering results.
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  const colorPicker = $('#colorPicker');
  const hexInput    = $('#hexInput');
  const rInput      = $('#rInput');
  const gInput      = $('#gInput');
  const bInput      = $('#bInput');
  const mixBtn      = $('#mixBtn');
  const results     = $('#results');

  // --- Input Synchronization ---

  function setFromHex(hex) {
    try {
      const c = chroma(hex);
      const [r, g, b] = c.rgb();
      colorPicker.value = c.hex();
      hexInput.value = c.hex();
      rInput.value = r;
      gInput.value = g;
      bInput.value = b;
    } catch {
      // invalid hex — ignore
    }
  }

  colorPicker.addEventListener('input', () => {
    setFromHex(colorPicker.value);
  });

  hexInput.addEventListener('input', () => {
    let val = hexInput.value.trim();
    if (!val.startsWith('#')) val = '#' + val;
    if (/^#[0-9a-f]{6}$/i.test(val)) {
      setFromHex(val);
    }
  });

  function onRGBChange() {
    const r = clamp(parseInt(rInput.value) || 0, 0, 255);
    const g = clamp(parseInt(gInput.value) || 0, 0, 255);
    const b = clamp(parseInt(bInput.value) || 0, 0, 255);
    setFromHex(chroma.rgb(r, g, b).hex());
  }

  rInput.addEventListener('change', onRGBChange);
  gInput.addEventListener('change', onRGBChange);
  bInput.addEventListener('change', onRGBChange);

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // --- Mix Button ---

  mixBtn.addEventListener('click', doMix);

  // Also mix on Enter key in any input
  [hexInput, rInput, gInput, bInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doMix();
    });
  });

  function doMix() {
    const hex = colorPicker.value;
    const result = ColorMixer.findMix(hex);
    renderResults(result);
  }

  // --- Render Results ---

  function renderResults(result) {
    results.classList.remove('hidden');

    // Swatches
    $('#targetSwatch').style.backgroundColor = result.targetHex;
    $('#targetHexLabel').textContent = result.targetHex;

    $('#mixedSwatch').style.backgroundColor = result.mixedHex;
    $('#mixedHexLabel').textContent = result.mixedHex;

    // Delta E
    const deEl = $('#deltaE');
    deEl.className = 'delta-e ' + result.accuracy.level;
    deEl.innerHTML = `<span class="de-value">&Delta;E ${result.deltaE}</span> &mdash; ${result.accuracy.text}`;

    // Ratios
    const ratiosEl = $('#ratios');
    ratiosEl.innerHTML = '';
    for (const paint of result.paints) {
      const row = document.createElement('div');
      row.className = 'ratio-row';
      row.innerHTML = `
        <div class="ratio-color" style="background:${paint.hex}"></div>
        <span class="ratio-name">${paint.name}</span>
        <div class="ratio-bar-bg">
          <div class="ratio-bar-fill" style="width:${paint.percent}%;background:${paint.hex}"></div>
        </div>
        <span class="ratio-percent">${paint.percent}%</span>
      `;
      ratiosEl.appendChild(row);
    }

    // Instructions
    const instrEl = $('#instructions');
    instrEl.innerHTML = '';
    for (const step of result.instructions) {
      const li = document.createElement('li');
      li.textContent = step;
      instrEl.appendChild(li);
    }

    // Smooth scroll to results
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Run initial mix on page load
  doMix();
})();
