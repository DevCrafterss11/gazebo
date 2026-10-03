import { Crosshair, Home, LoaderCircle, LocateFixed, MapPin, Minus, Navigation, Play, Plus, Rotate3d, Route as RouteIcon, Trash2, Undo2, X } from 'lucide-react';
import { AttributionControl, type GeoJSONSource, Map as MapLibreMap, type MapMouseEvent, Marker } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { RouteDraftWaypoint, RoutePlannerPhase } from '../../types/mission';
import type { FlightPathPoint } from '../../types/telemetry';
import styles from './FlightSceneViewport.module.css';

export interface RoutePlannerMapState {
  visible: boolean;
  editable: boolean;
  phase: RoutePlannerPhase;
  waypoints: RouteDraftWaypoint[];
  altitudeMeters: number;
  maxAltitudeMeters: number;
  vehicleReady: boolean;
  error: string | null;
  onAddWaypoint: (latitude: number, longitude: number) => void;
  onUndo: () => void;
  onClear: () => void;
  onCancel: () => void;
  onAltitudeChange: (altitudeMeters: number) => void;
  onExecute: () => void;
}

interface FlightSceneViewportProps {
  currentTask: string;
  altitudeMeters: number;
  speedMetersPerSecond: number;
  armed: boolean;
  latitude: number;
  longitude: number;
  home: { latitude: number; longitude: number };
  north: number;
  east: number;
  yaw: number;
  flightPath: FlightPathPoint[];
  mode: string;
  routePlanner?: RoutePlannerMapState;
}

interface MapPoint {
  north: number;
  east: number;
}

const defaultHome: [number, number] = [108.8289653, 34.1251589];
const busyRoutePhases: RoutePlannerPhase[] = ['UPLOADING', 'ARMING', 'STARTING'];
const routePhaseLabels: Record<RoutePlannerPhase, string> = {
  IDLE: '待规划', PLANNING: '规划中', UPLOADING: '上传中', ARMING: '解锁中', STARTING: '启动中',
  RUNNING: 'AUTO 执行中', COMPLETED: '已完成', ERROR: '需要处理',
};
const clampMapCoordinate = (value: number): number => Math.min(92, Math.max(8, value));
const isValidCoordinate = (latitude: number, longitude: number): boolean => Number.isFinite(latitude)
  && Number.isFinite(longitude)
  && latitude >= -90
  && latitude <= 90
  && longitude >= -180
  && longitude <= 180
  && (Math.abs(latitude) > 1e-6 || Math.abs(longitude) > 1e-6);

const compactPath = (points: FlightPathPoint[]): FlightPathPoint[] => {
  const compacted: FlightPathPoint[] = [];
  points.slice(-600).forEach((point) => {
    if (!isValidCoordinate(point.latitude, point.longitude)) return;
    const previous = compacted.at(-1);
    if (!previous || Math.hypot(point.north - previous.north, point.east - previous.east) >= 0.08) {
      compacted.push(point);
    }
  });
  return compacted;
};

const lineGeoJson = (coordinates: [number, number][]): GeoJSON.GeoJSON => coordinates.length < 2
  ? { type: 'FeatureCollection', features: [] }
  : { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };

export function FlightSceneViewport({
  currentTask,
  altitudeMeters,
  speedMetersPerSecond,
  armed,
  latitude,
  longitude,
  home,
  north,
  east,
  yaw,
  flightPath,
  mode,
  routePlanner,
}: FlightSceneViewportProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const homeMarkerRef = useRef<Marker | null>(null);
  const waypointMarkerRefs = useRef<Marker[]>([]);
  const routePlannerRef = useRef(routePlanner);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapViewRevision, setMapViewRevision] = useState(0);
  const isLanded = !armed && altitudeMeters < 0.3;
  const normalizedYaw = ((yaw % 360) + 360) % 360;
  const validHome = isValidCoordinate(home.latitude, home.longitude);
  const homeCoordinates: [number, number] = validHome ? [home.longitude, home.latitude] : defaultHome;
  const vehicleCoordinates: [number, number] = isValidCoordinate(latitude, longitude)
    ? [longitude, latitude]
    : homeCoordinates;
  const track = useMemo(() => compactPath(flightPath), [flightPath]);
  const trackGeoJson = useMemo(() => lineGeoJson(
    track.map((point) => [point.longitude, point.latitude] as [number, number]),
  ), [track]);
  const plannedRouteGeoJson = useMemo(() => {
    if (!routePlanner?.waypoints.length || routePlanner.phase === 'COMPLETED' || routePlanner.phase === 'IDLE') return lineGeoJson([]);
    return lineGeoJson([
      homeCoordinates,
      ...routePlanner.waypoints.map((point) => [point.longitude, point.latitude] as [number, number]),
      homeCoordinates,
    ]);
  }, [homeCoordinates[0], homeCoordinates[1], routePlanner?.phase, routePlanner?.waypoints]);
  const plannedRoutePoints = useMemo<MapPoint[]>(() => {
    if (!routePlanner?.waypoints.length || routePlanner.phase === 'COMPLETED' || routePlanner.phase === 'IDLE') return [];
    const longitudeScale = 111_111 * Math.cos((home.latitude * Math.PI) / 180);
    return routePlanner.waypoints.map((point) => ({
      north: (point.latitude - home.latitude) * 111_111,
      east: (point.longitude - home.longitude) * longitudeScale,
    }));
  }, [home.latitude, home.longitude, routePlanner?.phase, routePlanner?.waypoints]);
  const plannedScreenPath = useMemo(() => {
    if (!mapReady || !mapRef.current || !routePlanner?.waypoints.length || routePlanner.phase === 'COMPLETED' || routePlanner.phase === 'IDLE') return null;
    const width = mapContainerRef.current?.clientWidth ?? 0;
    const height = mapContainerRef.current?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return null;
    const coordinates = [
      homeCoordinates,
      ...routePlanner.waypoints.map((point) => [point.longitude, point.latitude] as [number, number]),
      homeCoordinates,
    ];
    return coordinates.map(([longitude, latitude]) => {
      const projected = mapRef.current!.project([longitude, latitude]);
      return `${((projected.x / width) * 100).toFixed(2)},${((projected.y / height) * 100).toFixed(2)}`;
    }).join(' ');
  }, [homeCoordinates[0], homeCoordinates[1], mapReady, mapViewRevision, routePlanner?.phase, routePlanner?.waypoints]);

  const mapExtent = Math.max(
    10,
    Math.ceil(Math.max(
      Math.abs(north),
      Math.abs(east),
      ...track.flatMap((point) => [Math.abs(point.north), Math.abs(point.east)]),
      ...plannedRoutePoints.flatMap((point) => [Math.abs(point.north), Math.abs(point.east)]),
    ) * 1.25 / 5) * 5,
  );
  const projectFallback = (point: MapPoint) => ({
    x: clampMapCoordinate(50 + (point.east / mapExtent) * 42),
    y: clampMapCoordinate(50 - (point.north / mapExtent) * 42),
  });
  const fallbackMarker = projectFallback({ north, east });
  const fallbackPath = track.map((point) => {
    const projected = projectFallback(point);
    return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
  }).join(' ');
  const plannedFallbackPath = plannedRoutePoints.length > 0
    ? [{ north: 0, east: 0 }, ...plannedRoutePoints, { north: 0, east: 0 }]
      .map((point) => {
        const projected = projectFallback(point);
        return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`;
      }).join(' ')
    : '';

  useEffect(() => {
    routePlannerRef.current = routePlanner;
  }, [routePlanner]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    try {
      const map = new MapLibreMap({
        container: mapContainerRef.current,
        center: homeCoordinates,
        zoom: 18,
        bearing: 0,
        pitch: 0,
        attributionControl: false,
        style: {
          version: 8,
          sources: {
            osm: {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '© OpenStreetMap contributors',
            },
          },
          layers: [{
            id: 'osm',
            type: 'raster',
            source: 'osm',
            paint: {
              'raster-saturation': -0.48,
              'raster-contrast': 0.12,
              'raster-brightness-min': 0.08,
              'raster-brightness-max': 0.82,
            },
          }],
        },
      });
      map.addControl(new AttributionControl({ compact: true }), 'top-left');
      map.on('load', () => {
        map.addSource('flight-track', { type: 'geojson', data: trackGeoJson, lineMetrics: true });
        map.addLayer({
          id: 'flight-track-shadow',
          type: 'line',
          source: 'flight-track',
          paint: { 'line-color': '#001923', 'line-width': 7, 'line-opacity': 0.72 },
        });
        map.addLayer({
          id: 'flight-track-line',
          type: 'line',
          source: 'flight-track',
          paint: {
            'line-width': 4,
            'line-opacity': 0.96,
            'line-color': ['interpolate', ['linear'], ['line-progress'], 0, '#7ce8ff', 0.65, '#22b6e8', 1, '#ffe174'],
          },
        });
        map.addSource('planned-route', { type: 'geojson', data: plannedRouteGeoJson });
        map.addLayer({
          id: 'planned-route-shadow',
          type: 'line',
          source: 'planned-route',
          paint: { 'line-color': '#04131d', 'line-width': 11, 'line-opacity': 0.86 },
        });
        map.addLayer({
          id: 'planned-route-line',
          type: 'line',
          source: 'planned-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffe066', 'line-width': 7, 'line-opacity': 1, 'line-blur': 0 },
        });
        setMapReady(true);
      });
      map.on('move', () => setMapViewRevision((revision) => revision + 1));

      const handleMapClick = (event: MapMouseEvent) => {
        const planner = routePlannerRef.current;
        if (!planner?.visible || !planner.editable) return;
        planner.onAddWaypoint(event.lngLat.lat, event.lngLat.lng);
      };
      map.on('click', handleMapClick);

      const vehicleElement = document.createElement('div');
      vehicleElement.className = styles.vehicleMapMarker ?? '';
      vehicleElement.title = '无人机实时位置与航向';
      vehicleMarkerRef.current = new Marker({
        element: vehicleElement,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      }).setLngLat(vehicleCoordinates).setRotation(normalizedYaw).addTo(map);

      const homeElement = document.createElement('div');
      homeElement.className = styles.homeMapMarker ?? '';
      homeElement.textContent = 'H';
      homeElement.title = 'Home 点';
      homeMarkerRef.current = new Marker({ element: homeElement, anchor: 'center' })
        .setLngLat(homeCoordinates)
        .addTo(map);

      const resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(mapContainerRef.current);
      mapRef.current = map;
      return () => {
        resizeObserver.disconnect();
        vehicleMarkerRef.current?.remove();
        homeMarkerRef.current?.remove();
        waypointMarkerRefs.current.forEach((marker) => marker.remove());
        waypointMarkerRefs.current = [];
        vehicleMarkerRef.current = null;
        homeMarkerRef.current = null;
        map.remove();
        mapRef.current = null;
      };
    } catch (error: unknown) {
      console.error('Unable to initialize the flight map', error);
      setMapFailed(true);
    }
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource('flight-track') as GeoJSONSource | undefined;
    source?.setData(trackGeoJson);
  }, [mapReady, trackGeoJson]);

  useEffect(() => {
    const source = mapRef.current?.getSource('planned-route') as GeoJSONSource | undefined;
    source?.setData(plannedRouteGeoJson);
  }, [mapReady, plannedRouteGeoJson]);

  useEffect(() => {
    waypointMarkerRefs.current.forEach((marker) => marker.remove());
    waypointMarkerRefs.current = [];
    if (!mapRef.current || !routePlanner?.waypoints.length || routePlanner.phase === 'COMPLETED' || routePlanner.phase === 'IDLE') return;
    waypointMarkerRefs.current = routePlanner.waypoints.map((point, index) => {
      const element = document.createElement('div');
      element.className = styles.routeWaypointMarker ?? '';
      element.textContent = String(index + 1);
      element.title = `航点 ${index + 1}`;
      element.setAttribute('role', 'img');
      element.setAttribute('aria-label', `航点 ${index + 1}`);
      return new Marker({ element, anchor: 'center' }).setLngLat([point.longitude, point.latitude]).addTo(mapRef.current!);
    });
    return () => {
      waypointMarkerRefs.current.forEach((marker) => marker.remove());
      waypointMarkerRefs.current = [];
    };
  }, [mapReady, routePlanner?.phase, routePlanner?.waypoints]);

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = routePlanner?.visible && routePlanner.editable ? 'crosshair' : '';
  }, [mapReady, routePlanner?.editable, routePlanner?.visible]);

  useEffect(() => {
    vehicleMarkerRef.current?.setLngLat(vehicleCoordinates).setRotation(normalizedYaw);
  }, [latitude, longitude, normalizedYaw]);

  useEffect(() => {
    const vehicleElement = vehicleMarkerRef.current?.getElement();
    const homeElement = homeMarkerRef.current?.getElement();
    if (vehicleElement) {
      vehicleElement.dataset.landed = String(isLanded);
      vehicleElement.title = isLanded ? '无人机已降落在 Home 点' : '无人机实时位置与航向';
    }
    if (homeElement) homeElement.dataset.occupied = String(isLanded);
  }, [isLanded, mapReady]);

  useEffect(() => {
    homeMarkerRef.current?.setLngLat(homeCoordinates);
  }, [home.latitude, home.longitude]);

  const recenter = () => mapRef.current?.easeTo({ center: vehicleCoordinates, zoom: Math.max(18, mapRef.current.getZoom()), duration: 700 });

  return (
    <div className={styles.viewport} aria-label="无人机实时地图与飞行轨迹">
      {!mapFailed ? <div className={styles.mapCanvas} ref={mapContainerRef} /> : (
        <div className={styles.mapLayer} aria-label="离线飞行坐标视图">
          <span className={styles.cardinalNorth}>N</span>
          <span className={styles.cardinalEast}>E</span>
          <span className={styles.cardinalSouth}>S</span>
          <span className={styles.cardinalWest}>W</span>
          <span className={styles.homePoint} style={{ left: '50%', top: '50%' }}><Home size={13} /></span>
          {fallbackPath ? (
            <svg className={styles.flightPath} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polyline className={styles.flightPathShadow} points={fallbackPath} />
              <polyline points={fallbackPath} />
            </svg>
          ) : null}
          {plannedFallbackPath ? (
            <svg className={styles.plannedRoutePath} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="自定义航线连线">
              <polyline className={styles.plannedRoutePathShadow} points={plannedFallbackPath} />
              <polyline points={plannedFallbackPath} />
            </svg>
          ) : null}
          <span className={styles.droneMarker} style={{ left: `${fallbackMarker.x}%`, top: `${fallbackMarker.y}%`, transform: `translate(-50%, -50%) rotate(${normalizedYaw}deg)` }}>
            <span className={styles.headingVector} />
            <Navigation className={styles.droneNose} size={15} />
            <i className={styles.rotorHorizontal} />
            <i className={styles.rotorVertical} />
            <i className={styles.droneCore} />
          </span>
          <span className={styles.scaleLabel}>±{mapExtent.toFixed(0)} m</span>
        </div>
      )}
      {!mapFailed && plannedScreenPath ? (
        <svg className={styles.plannedRouteOverlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="自定义航线连线">
          <polyline className={styles.plannedRouteOverlayShadow} points={plannedScreenPath} />
          <polyline points={plannedScreenPath} />
        </svg>
      ) : null}
      <div className={styles.taskBanner}>
        <Crosshair size={16} />
        <span>当前任务</span>
        <strong>{currentTask}</strong>
        <small>{isLanded ? '无人机已降落 · Home' : '保持高度与位置稳定'}</small>
      </div>
      <div className={styles.compass}><strong>N</strong><Navigation size={18} /></div>
      {!mapFailed ? (
        <div className={styles.mapControls}>
          <button type="button" title="定位无人机" aria-label="定位无人机" onClick={recenter}><LocateFixed size={16} /></button>
          <button type="button" title="放大地图" aria-label="放大地图" onClick={() => mapRef.current?.zoomIn()}><Plus size={16} /></button>
          <button type="button" title="缩小地图" aria-label="缩小地图" onClick={() => mapRef.current?.zoomOut()}><Minus size={16} /></button>
        </div>
      ) : null}
      {routePlanner?.visible && !mapFailed ? (
        <div className={styles.routePlannerToolbar}>
          <div className={styles.routePlannerIdentity}>
            <RouteIcon size={17} />
            <span><strong>自定义航线</strong><small>{routePhaseLabels[routePlanner.phase]} · {routePlanner.waypoints.length}/20 航点</small></span>
          </div>
          <label className={styles.routeAltitude}>
            <span>高度</span>
            <input
              type="number"
              min={2}
              max={routePlanner.maxAltitudeMeters}
              step={1}
              value={routePlanner.altitudeMeters}
              disabled={!routePlanner.editable}
              onChange={(event) => routePlanner.onAltitudeChange(Number(event.target.value))}
            />
            <i>m</i>
          </label>
          <div className={styles.routePlannerActions}>
            <button type="button" title="撤销上一个航点" aria-label="撤销上一个航点" disabled={!routePlanner.editable || routePlanner.waypoints.length === 0} onClick={routePlanner.onUndo}><Undo2 size={15} /></button>
            <button type="button" title="清空航点" aria-label="清空航点" disabled={!routePlanner.editable || routePlanner.waypoints.length === 0} onClick={routePlanner.onClear}><Trash2 size={15} /></button>
            <button type="button" title="取消航线规划" aria-label="取消航线规划" disabled={busyRoutePhases.includes(routePlanner.phase) || routePlanner.phase === 'RUNNING'} onClick={routePlanner.onCancel}><X size={16} /></button>
            <button
              className={styles.executeRouteButton}
              type="button"
              disabled={!routePlanner.vehicleReady || routePlanner.waypoints.length === 0 || busyRoutePhases.includes(routePlanner.phase) || routePlanner.phase === 'RUNNING'}
              onClick={routePlanner.onExecute}
            >
              {busyRoutePhases.includes(routePlanner.phase) ? <LoaderCircle className={styles.routeSpinner} size={15} /> : <Play size={15} />}
              <span>{routePlanner.phase === 'RUNNING' ? '执行中' : '执行航线'}</span>
            </button>
          </div>
          {routePlanner.error ? <div className={styles.routePlannerError} role="alert">{routePlanner.error}</div> : null}
          {routePlanner.editable && routePlanner.waypoints.length === 0 ? <div className={styles.routePlannerHint}><MapPin size={13} /><span>地图选点</span></div> : null}
        </div>
      ) : null}
      <div className={styles.telemetryHud}>
        <div><span>ALT</span><strong>{altitudeMeters.toFixed(1)} m</strong></div>
        <div><span>SPEED</span><strong>{speedMetersPerSecond.toFixed(1)} m/s</strong></div>
        <div><span>HEADING</span><strong>{normalizedYaw.toFixed(0)}°</strong></div>
        <div><span>MODE</span><strong>{mode}</strong></div>
      </div>
      <div className={styles.viewLabel}>
        <Rotate3d size={15} />
        <div>
          <strong>{mapFailed ? '离线坐标视图' : 'OpenStreetMap'}</strong>
          <span>N {north.toFixed(1)} m · E {east.toFixed(1)} m</span>
        </div>
      </div>
    </div>
  );
}
