# Reference inputs for the generated browser lookups

`System_ISCC-NBS.txt`: 932 elementary HVC boundary blocks, copied from CRAN munsellinterpol 3.6-0. Its comments retain the primary NBS reference. The package license is GPL 3 or later.

`hierarchy-iscc-nbs.json`: 267 category names and the 29/13 hierarchy, with sources recorded inside. The roll-up was transcribed from Identification of Colors for Building (1962), Appendix B/C.

Install requirements.txt in a separate development environment, then run `python tools/build-color-data.py` from the repository root. colour-science supplies the renotation data. The live application has no Python dependencies.

See ../../dist/COLOR-DATA.md and ../../dist/licenses/ for provenance, approximation details and license notices.
