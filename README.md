# Colormixer

A tool that helps answer: **"I have this color — how do I mix it with real paint?"**

Enter any HEX or RGB color, and Colormixer will tell you how to mix it using five basic artist paints: red, yellow, blue, white, and black. You get approximate ratios, a visual comparison, an accuracy score, and step-by-step mixing instructions.

## Quick Start

Open `index.html` in any modern browser. No build step, no dependencies to install — it loads [chroma.js](https://gka.github.io/chroma.js/) from a CDN.

## How It Works

1. Your target color is converted to the **CIELAB** color space (perceptually uniform)
2. A constrained optimization finds the best mix of 5 base paints that minimizes perceptual color difference
3. **Delta E (CIE2000)** scores how close the approximation is to your target
4. Results are presented as percentages with step-by-step instructions

## Base Paints

| Paint  | Pigment Equivalent | Purpose              |
|--------|--------------------|----------------------|
| Red    | Cadmium Red        | Warm primary          |
| Yellow | Cadmium Yellow     | Warm primary          |
| Blue   | Ultramarine Blue   | Cool primary          |
| White  | Titanium White     | Lightening / tinting  |
| Black  | Ivory Black        | Darkening / shading   |

## Limitations

- Digital and physical colors behave fundamentally differently (additive vs. subtractive)
- This MVP uses weighted LAB averaging as an approximation of subtractive mixing
- Results depend on actual pigments, surface, and lighting conditions
- Not all digital colors can be reproduced with paint (gamut differences)

## Roadmap

- **V1**: Custom paint palettes, interactive ratio adjustment, better optimization
- **V2**: Physics-based simulation (Kubelka-Munk model), spectral reflectance
- **V3**: Community pigment database, brand-specific paints, camera matching

## License

MIT
