import type { StyleSpecification } from 'maplibre-gl';

export const geographicBasemapSourceId = 'geographic-basemap';

export function geographicMapStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      [geographicBasemapSourceId]: {
        type: 'raster',
        tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Vantor, Earthstar Geographics, GIS User Community',
      },
    },
    layers: [
      { id: 'map-background', type: 'background', paint: { 'background-color': '#0a2b37' } },
      { id: geographicBasemapSourceId, type: 'raster', source: geographicBasemapSourceId,
        paint: { 'raster-fade-duration': 180, 'raster-saturation': 0.08, 'raster-contrast': 0.05 } },
    ],
  };
}
