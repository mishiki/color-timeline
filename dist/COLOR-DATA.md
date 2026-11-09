# Color classification and coordinate data

The browser uses precomputed data, with no Python or network API required at runtime.

- `iscc-data.js`: a 129³ sRGB lookup, derived from inverse-interpolated Munsell renotation coordinates and the 932 elementary HVC boundary blocks defining ISCC–NBS 267 categories. These are rolled up to the 13 Level-1 names using the BRI Appendix B/C mapping. This is not nearest-centroid RGB classification.
- `munsell-data.js`: a 65³ sRGB coordinate lookup. Trilinear interpolation uses `(C cos H, V, C sin H)` so the hue seam remains continuous. Quantization scales are 512 for the chroma components and 2048 for Value. The visualization's angular H scale is Munsell's 0–100 circle (R, YR, Y, GY, G, BG, B, PB, P, RP), not HSV degrees. V is 0–10 and C is radial chroma.
- RGB to Munsell is approximate: sRGB linearization, XYZ D65 → illuminant C Bradford adaptation, CIE 1931 2° observer, ASTM D1535 Y–V polynomial, piecewise inverse interpolation of renotation xy in each Value plane and interpolation between planes. Value below 0.2 lies below the data range and is approximated as neutral. Pure sRGB grays are shown on the neutral axis.
- The view overlays equal-sized representative markers and a full-image histogram (alpha >= 24, no region weighting). The histogram uses fixed 20 hue × 20 Value × 20 chroma bins; each occupied bin is positioned at its Cartesian-chroma centroid and colored by its mean RGB. Cube volume encodes raw pixel share or log1p(100*share)/log(101). The wireframe is a coordinate guide, not a measured gamut boundary. Axes remain fixed across video frames.

## Sources and notices

ISCC–NBS boundaries were taken from CRAN `munsellinterpol` 3.6-0, `inst/extdata/System_ISCC-NBS.txt`. The source attributes the table to Kelly & Judd, *Color: Universal Language and Dictionary of Names*, NBS Special Publication 440 (1976), Section 13. The CRAN package is distributed under GPL 3 or later; its derived lookup and included table are supplied on that basis. See [GPL-3.0.txt](licenses/GPL-3.0.txt). The regeneration source and boundary data are in the repository's `tools/` directory.

- https://github.com/cran/munsellinterpol
- https://files.eric.ed.gov/fulltext/ED026831.pdf — *Identification of Colors for Building* (1962), Appendix B/C; the 267→29→13 membership was transcribed from the table. The CRAN license is not asserted for this separate source.
- https://www.rit.edu/science/munsell-color-science-lab-educational-resources — Munsell renotation data, used via colour-science 0.4.7. colour-science is BSD-3-Clause; its copyright notice and license are in [colour-science.txt](licenses/colour-science.txt).
- https://github.com/colour-science/colour/tree/v0.4.7

## Regeneration

From the repository root, install Python packages `colour-science==0.4.7`, NumPy and SciPy in a separate development environment, then run `python tools/build-color-data.py`. These are development dependencies only. No source character images or personal region data are included in the web application.

An earlier limited check against the colour-science inverse algorithm agreed on 46 of 47 classifiable RGB samples (one of 48 reference conversions failed). This is a smoke check, not a whole-gamut accuracy or perception guarantee. Context, contrast, color constancy and spatial attention are not modeled.
