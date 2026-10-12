export interface MapCoordinates {
  latitude: number;
  longitude: number;
}

export interface FlightMapView {
  contextId: string;
  center: MapCoordinates;
  zoom: number;
}
