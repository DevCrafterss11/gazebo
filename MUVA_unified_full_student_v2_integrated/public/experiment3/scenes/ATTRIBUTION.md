# Experiment 3 satellite imagery

These four local JPEGs are subsets of **Sentinel-2 cloudless (2016)** by
**EOX IT Services GmbH**, containing modified **Copernicus Sentinel data (2016)**.
They are not generated illustrations or live satellite imagery.

- Source service: https://tiles.maps.eox.at/wms
- Layer: `s2cloudless` (2016), WMS 1.1.1, EPSG:4326, JPEG, 1024 × 768.
- Source attribution / license declaration: the WMS `GetCapabilities` abstract
  for `s2cloudless`.
- License: Creative Commons Attribution 4.0 International (CC BY 4.0):
  https://creativecommons.org/licenses/by/4.0/
- Producer: https://eox.at/ ; imagery project: https://s2maps.eu/

| Local image | Example location | Bounding box (west, south, east, north) |
| --- | --- | --- |
| campus-satellite.jpg | Stanford campus, California | -122.19, 37.415, -122.15, 37.445 |
| city-satellite.jpg | San Francisco, California | -122.435, 37.755, -122.395, 37.785 |
| mountain-satellite.jpg | Yosemite mountain region, California | -119.62, 37.72, -119.54, 37.78 |
| airport-satellite.jpg | San Francisco airport, California | -122.405, 37.595, -122.345, 37.64 |

The images are regional teaching backgrounds, not surveyed training sites.
They are clipped by the viewport and dimmed by CSS for model readability;
the original local JPEG pixels are otherwise unchanged. Training coordinates,
wind, targets and safety boundaries remain frontend simulation parameters and
are **not georeferenced to these images**. No live tile or imagery service is
requested for these previews. Experiment 1 also uses these four images for
teaching scene selection; its Home coordinates and markers are illustrative,
not aligned with the imagery or real-world survey data.
