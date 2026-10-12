import { AlertTriangle, ChevronUp, Crosshair, Drone, Home, LoaderCircle, LocateFixed, MapPin, Minus, Navigation, Play, Plus, Rotate3d, Route as RouteIcon, Trash2, Undo2, X } from 'lucide-react';
import { AttributionControl, type GeoJSONSource, LngLatBounds, Map as MapLibreMap, type MapMouseEvent, Marker } from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';

import 'maplibre-gl/dist/maplibre-gl.css';

import type { RouteDraftWaypoint, RoutePlannerPhase } from '../../types/mission';
import type { FlightPathPoint } from '../../types/telemetry';
import type { FlightMapView, MapCoordinates } from '../../types/flightMap';
import { homeDistanceMeters, initialFlightMapView, offscreenVehicleIndicator } from '../../domain/flightMap';
import { geographicBasemapSourceId, geographicMapStyle } from '../../domain/geographicMap';
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

export interface FlightSceneMapContext {
  contextId: string;
  sceneName: string;
  coordinateMode?: 'geographic' | 'scene-relative';
  configuredHome: MapCoordinates;
  actualHome: MapCoordinates | null;
  telemetryReady: boolean;
  savedView: FlightMapView | null;
  onViewChange: (view: FlightMapView) => void;
  mapError: string | null;
  onRetryMap: () => void;
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
  sceneContext?: FlightSceneMapContext;
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

const createVehicleMarkerElement = (): HTMLDivElement => {
  const element = document.createElement('div');
  element.className = styles.vehicleMapMarker ?? '';
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', '无人机实时位置');
  const namespace = 'http://www.w3.org/2000/svg';
  const glyph = document.createElementNS(namespace, 'svg');
  glyph.setAttribute('viewBox', '0 0 32 32');
  glyph.setAttribute('fill', 'none');
  glyph.setAttribute('stroke', 'currentColor');
  glyph.setAttribute('stroke-width', '2');
  glyph.setAttribute('aria-hidden', 'true');
  const frame = document.createElementNS(namespace, 'path');
  frame.setAttribute('d', 'M10 10 22 22 M22 10 10 22 M13 13 H19 V19 H13 Z');
  glyph.append(frame);
  for (const [centerX, centerY] of [[7, 7], [25, 7], [7, 25], [25, 25]]) {
    const rotor = document.createElementNS(namespace, 'circle');
    rotor.setAttribute('cx', String(centerX));
    rotor.setAttribute('cy', String(centerY));
    rotor.setAttribute('r', '5');
    glyph.append(rotor);
  }
  element.append(glyph);
  return element;
};

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
  sceneContext,
}: FlightSceneViewportProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<Marker | null>(null);
  const homeMarkerRef = useRef<Marker | null>(null);
  const configuredHomeMarkerRef = useRef<Marker | null>(null);
  const waypointMarkerRefs = useRef<Marker[]>([]);
  const routePlannerRef = useRef(routePlanner);
  const hasAutoFittedTrackRef = useRef(false);
  const lastMapViewRef = useRef<FlightMapView | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [basemapReady, setBasemapReady] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapViewRevision, setMapViewRevision] = useState(0);
  const vehicleVisible = sceneContext?.telemetryReady ?? true;
  const isLanded = vehicleVisible && !armed && altitudeMeters < 0.3;
  const homeMismatch = sceneContext?.actualHome
    ? homeDistanceMeters(sceneContext.configuredHome, sceneContext.actualHome) : 0;
  const sceneRelative = sceneContext?.coordinateMode === 'scene-relative';
  const landedAtHome = isLanded && Math.hypot(north, east) <= 1;
  const normalizedYaw = ((yaw % 360) + 360) % 360;
  const validHome = isValidCoordinate(home.latitude, home.longitude);
  const homeCoordinates: [number, number] = validHome ? [home.longitude, home.latitude] : defaultHome;
  const vehicleCoordinates: [number, number] = isValidCoordinate(latitude, longitude)
    ? [longitude, latitude]
    : homeCoordinates;
  const offscreenVehicle = useMemo(() => {
    if (!vehicleVisible || !mapReady || mapFailed || !mapRef.current || !mapContainerRef.current) return null;
    return offscreenVehicleIndicator(mapRef.current.project(vehicleCoordinates),
      mapContainerRef.current.clientWidth, mapContainerRef.current.clientHeight);
  }, [latitude, longitude, vehicleVisible, mapReady, mapFailed, mapViewRevision]);
  const mapStatus = sceneContext?.mapError ?? (!vehicleVisible ? '等待有效遥测 · 不显示默认无人机位置'
    : sceneContext && !sceneContext.actualHome ? '飞控 HOME 尚未确认 · 航线执行暂不可用'
      : homeMismatch > 5 ? sceneRelative
        ? `场景 HOME 与飞控 HOME 相距 ${homeMismatch.toFixed(1)} m。地图以所选 HOME 为原点显示真实相对位移；原始遥测和飞控 HOME 未修改。`
        : `配置 HOME 与飞控 HOME 相距 ${homeMismatch.toFixed(1)} m；无人机与轨迹使用真实坐标。` : null);
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
  const trackScreenPath = useMemo(() => {
    if (!mapReady || !mapRef.current || track.length < 2) return null;
    const width = mapContainerRef.current?.clientWidth ?? 0;
    const height = mapContainerRef.current?.clientHeight ?? 0;
    if (width <= 0 || height <= 0) return null;
    return track.map((point) => {
      const projected = mapRef.current!.project([point.longitude, point.latitude]);
      return `${((projected.x / width) * 100).toFixed(2)},${((projected.y / height) * 100).toFixed(2)}`;
    }).join(' ');
  }, [mapReady, mapViewRevision, track]);

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
    setMapReady(false);
    setMapFailed(false);
    setBasemapReady(false);
    hasAutoFittedTrackRef.current = false;
    let disposed = false;
    let map: MapLibreMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const mountedContext = sceneContext;
    const initialView = mountedContext ? initialFlightMapView(mountedContext.contextId, mountedContext.configuredHome,
      lastMapViewRef.current?.contextId === mountedContext.contextId ? lastMapViewRef.current : mountedContext.savedView) : null;
    const recordView = () => {
      if (!map || !mountedContext) return;
      const center = map.getCenter().wrap();
      const view = { contextId: mountedContext.contextId, center: { latitude: center.lat, longitude: center.lng }, zoom: map.getZoom() };
      lastMapViewRef.current = view;
      mountedContext.onViewChange(view);
    };
    const timeout = window.setTimeout(() => { if (!disposed) setMapFailed(true); }, 12000);
    try {
      map = new MapLibreMap({
        container: mapContainerRef.current,
        center: initialView ? [initialView.center.longitude, initialView.center.latitude] : homeCoordinates,
        zoom: initialView?.zoom ?? 18,
        bearing: 0,
        pitch: 0,
        attributionControl: false,
        style: geographicMapStyle(),
      });
      const activeMap = map;
      map.addControl(new AttributionControl({ compact: true }), 'top-left');
      map.on('sourcedata', (event) => {
        const tile: unknown = event.tile;
        if (disposed || event.sourceId !== geographicBasemapSourceId || !tile || typeof tile !== 'object' || !('state' in tile) || tile.state !== 'loaded') return;
        window.clearTimeout(timeout);
        setBasemapReady(true);
        setMapFailed(false);
      });
      map.on('load', () => {
        if (disposed) return;
        activeMap.addSource('planned-route', { type: 'geojson', data: plannedRouteGeoJson });
        activeMap.addLayer({
          id: 'planned-route-shadow',
          type: 'line',
          source: 'planned-route',
          paint: { 'line-color': '#04131d', 'line-width': 11, 'line-opacity': 0.86 },
        });
        activeMap.addLayer({
          id: 'planned-route-line',
          type: 'line',
          source: 'planned-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffe066', 'line-width': 7, 'line-opacity': 1, 'line-blur': 0 },
        });
        activeMap.addSource('flight-track', { type: 'geojson', data: trackGeoJson, lineMetrics: true });
        activeMap.addLayer({
          id: 'flight-track-shadow',
          type: 'line',
          source: 'flight-track',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#001923', 'line-width': 12, 'line-opacity': 0.78 },
        });
        activeMap.addLayer({
          id: 'flight-track-glow',
          type: 'line',
          source: 'flight-track',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#16d9ff', 'line-width': 10, 'line-opacity': 0.38, 'line-blur': 4 },
        });
        activeMap.addLayer({
          id: 'flight-track-line',
          type: 'line',
          source: 'flight-track',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-width': 6,
            'line-opacity': 1,
            'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, '#b8f6ff', 0.55, '#38ddff', 1, '#00b8ee'],
          },
        });
        setMapReady(true);
      });
      map.on('move', () => { if (!disposed) setMapViewRevision((revision) => revision + 1); });
      map.on('moveend', recordView);
      map.on('error', (event) => {
        const sourceId = 'sourceId' in event ? event.sourceId : null;
        if (!disposed && (!sourceId || sourceId === geographicBasemapSourceId)) setMapFailed(true);
      });

      const handleMapClick = (event: MapMouseEvent) => {
        const planner = routePlannerRef.current;
        if (!planner?.visible || !planner.editable) return;
        planner.onAddWaypoint(event.lngLat.lat, event.lngLat.lng);
      };
      map.on('click', handleMapClick);

      const vehicleElement = createVehicleMarkerElement();
      vehicleElement.title = '无人机实时位置与航向';
      vehicleMarkerRef.current = new Marker({
        element: vehicleElement,
        anchor: 'center',
        rotationAlignment: 'map',
        pitchAlignment: 'map',
      }).setLngLat(vehicleCoordinates).setRotation(normalizedYaw).addTo(map);
      vehicleElement.hidden = !vehicleVisible;

      const homeElement = document.createElement('div');
      homeElement.className = styles.homeMapMarker ?? '';
      homeElement.textContent = 'H';
      homeElement.title = 'Home 点';
      homeMarkerRef.current = new Marker({ element: homeElement, anchor: 'center' })
        .setLngLat(homeCoordinates)
        .addTo(map);

      if (mountedContext) {
        homeElement.title = mountedContext.coordinateMode === 'scene-relative' ? '场景 Home · 步骤3所选起飞点' : mountedContext.actualHome ? '飞控实际 Home' : '配置 Home · 等待飞控确认';
        const configuredElement = document.createElement('div');
        configuredElement.className = styles.configuredHomeMarker ?? '';
        configuredElement.textContent = 'C';
        configuredElement.title = '步骤3配置的起飞点';
        configuredElement.hidden = sceneRelative || homeMismatch <= 5;
        configuredHomeMarkerRef.current = new Marker({ element: configuredElement, anchor: 'center' })
          .setLngLat([mountedContext.configuredHome.longitude, mountedContext.configuredHome.latitude]).addTo(map);
      }

      resizeObserver = new ResizeObserver(() => {
        activeMap.resize();
        if (!disposed) setMapViewRevision((revision) => revision + 1);
      });
      resizeObserver.observe(mapContainerRef.current);
      mapRef.current = map;
    } catch (error: unknown) {
      console.error('Unable to initialize the flight map', error);
      setMapFailed(true);
    }
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
      recordView();
      resizeObserver?.disconnect();
      vehicleMarkerRef.current?.remove();
      homeMarkerRef.current?.remove();
      configuredHomeMarkerRef.current?.remove();
      waypointMarkerRefs.current.forEach((marker) => marker.remove());
      waypointMarkerRefs.current = [];
      vehicleMarkerRef.current = null;
      homeMarkerRef.current = null;
      configuredHomeMarkerRef.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [sceneContext?.contextId, mapAttempt]);

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
    const element = vehicleMarkerRef.current?.getElement();
    if (element) element.hidden = !vehicleVisible;
  }, [latitude, longitude, normalizedYaw, vehicleVisible, mapReady]);

  useEffect(() => {
    const vehicleElement = vehicleMarkerRef.current?.getElement();
    const homeElement = homeMarkerRef.current?.getElement();
    if (vehicleElement) {
      vehicleElement.dataset.landed = String(isLanded);
      vehicleElement.title = landedAtHome ? '无人机已降落在 Home 点' : isLanded ? '无人机已降落' : '无人机实时位置与航向';
    }
    if (homeElement) homeElement.dataset.occupied = String(landedAtHome);
  }, [isLanded, landedAtHome, mapReady]);

  useEffect(() => {
    homeMarkerRef.current?.setLngLat(homeCoordinates);
    const homeElement = homeMarkerRef.current?.getElement();
    if (homeElement && sceneContext) homeElement.title = sceneRelative ? '场景 Home · 步骤3所选起飞点' : sceneContext.actualHome ? '飞控实际 Home' : '配置 Home · 等待飞控确认';
    const configuredElement = configuredHomeMarkerRef.current?.getElement();
    if (configuredElement) configuredElement.hidden = sceneRelative || homeMismatch <= 5;
  }, [home.latitude, home.longitude, sceneContext?.actualHome, homeMismatch, sceneRelative, mapReady]);

  const recenter = () => mapRef.current?.easeTo({ center: vehicleCoordinates, zoom: Math.max(18, mapRef.current.getZoom()), duration: 700 });
  const locateHome = () => mapRef.current?.easeTo({ center: sceneContext
    ? [sceneContext.configuredHome.longitude, sceneContext.configuredHome.latitude] : homeCoordinates, zoom: 18, duration: 700 });
  const fitTrack = () => {
    const map = mapRef.current;
    if (!map) return;
    const coordinates = [
      homeCoordinates,
      ...track.map((point) => [point.longitude, point.latitude] as [number, number]),
      ...(vehicleVisible ? [vehicleCoordinates] : []),
    ];
    if (coordinates.every(([longitude, latitude]) => homeDistanceMeters(home, { latitude, longitude }) < 1)) {
      locateHome();
      return;
    }
    const bounds = coordinates.slice(1).reduce(
      (nextBounds, coordinate) => nextBounds.extend(coordinate),
      new LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, {
      padding: { top: 82, right: 72, bottom: 70, left: 72 },
      maxZoom: 18.5,
      duration: 700,
    });
  };

  useEffect(() => {
    if (sceneContext || !mapReady || track.length < 2 || hasAutoFittedTrackRef.current) return;
    const first = track[0];
    if (!first) return;
    const hasMovement = track.some((point) => point.latitude !== first.latitude || point.longitude !== first.longitude);
    if (!hasMovement) return;
    hasAutoFittedTrackRef.current = true;
    fitTrack();
  }, [mapReady, track]);

  return (
    <div className={styles.viewport} aria-label="无人机实时地图与飞行轨迹" data-coordinate-mode={sceneContext?.coordinateMode ?? 'geographic'} data-scene-id={sceneContext?.contextId} data-basemap-status={mapFailed ? 'error' : basemapReady ? 'ready' : 'loading'}>
      <div className={styles.mapCanvas} ref={mapContainerRef} hidden={mapFailed} />
      {mapFailed ? (
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
          {vehicleVisible ? <span className={styles.droneMarker} style={{ left: `${fallbackMarker.x}%`, top: `${fallbackMarker.y}%`, transform: `translate(-50%, -50%) rotate(${normalizedYaw}deg)` }}>
            <span className={styles.headingVector} />
            <Navigation className={styles.droneNose} size={15} />
            <i className={styles.rotorHorizontal} />
            <i className={styles.rotorVertical} />
            <i className={styles.droneCore} />
          </span> : null}
          <span className={styles.scaleLabel}>±{mapExtent.toFixed(0)} m</span>
        </div>
      ) : null}
      {mapStatus ? <span className={styles.mapStatus} role={sceneContext?.mapError ? 'alert' : 'status'}>{mapStatus}</span> : null}
      {sceneRelative && homeMismatch > 5 ? <span className={styles.sceneCoordinateNotice} title={mapStatus ?? undefined}>场景相对坐标 · 飞控原点已映射</span> : null}
      {!mapFailed && !basemapReady ? <div className={styles.mapFailure} role="status">正在按场景坐标加载二维地图…</div> : null}
      {mapFailed ? <div className={styles.mapFailure} role="status">在线地图加载失败，当前仅为离线坐标示意，不是地理底图。飞行训练仍可继续。<button type="button" onClick={() => setMapAttempt((attempt) => attempt + 1)}>重试在线底图</button></div> : null}
      {!mapFailed && plannedScreenPath ? (
        <svg className={styles.plannedRouteOverlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="自定义航线连线">
          <polyline className={styles.plannedRouteOverlayShadow} points={plannedScreenPath} />
          <polyline points={plannedScreenPath} />
        </svg>
      ) : null}
      {!mapFailed && trackScreenPath ? (
        <svg className={styles.flightTrackOverlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="无人机实际飞行轨迹">
          <polyline className={styles.flightTrackOverlayShadow} points={trackScreenPath} />
          <polyline className={styles.flightTrackOverlayGlow} points={trackScreenPath} />
          <polyline points={trackScreenPath} />
        </svg>
      ) : null}
      {offscreenVehicle ? <button
        type="button"
        className={styles.offscreenVehicle}
        aria-label="无人机在视野外，点击定位"
        title="无人机在当前地图视野外，点击查看真实位置"
        style={{ left: offscreenVehicle.x, top: offscreenVehicle.y }}
        onClick={recenter}
      >
        <span className={styles.offscreenDirection} style={{ transform: `rotate(${offscreenVehicle.bearing}deg)` }}><ChevronUp size={14} /></span>
        <Drone size={26} />
      </button> : null}
      <div className={styles.taskBanner}>
        <Crosshair size={16} />
        <span>当前任务</span>
        <strong>{currentTask}</strong>
        <small>{!vehicleVisible ? '等待遥测' : landedAtHome ? '无人机已降落 · Home' : isLanded ? '无人机已降落' : '保持高度与位置稳定'}</small>
      </div>
      <div className={styles.compass}><strong>N</strong><Navigation size={18} /></div>
      {!mapFailed ? (
        <div className={styles.mapControls}>
          <button type="button" title="定位无人机" aria-label="定位无人机" disabled={!vehicleVisible} onClick={recenter}><LocateFixed size={16} /></button>
          {sceneContext ? <button type="button" title="定位配置 HOME" aria-label="定位配置 HOME" onClick={locateHome}><Home size={16} /></button> : null}
          {sceneContext && mapStatus ? <button type="button" title={mapStatus} aria-label={sceneRelative ? '刷新场景定位' : '重新读取飞控 HOME'} onClick={sceneContext.onRetryMap}><AlertTriangle size={16} /></button> : null}
          <button type="button" title="显示完整飞行轨迹" aria-label="显示完整飞行轨迹" onClick={fitTrack}><RouteIcon size={16} /></button>
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
        <div><span>ALT</span><strong>{vehicleVisible ? `${altitudeMeters.toFixed(1)} m` : '—'}</strong></div>
        <div><span>SPEED</span><strong>{vehicleVisible ? `${speedMetersPerSecond.toFixed(1)} m/s` : '—'}</strong></div>
        <div><span>HEADING</span><strong>{vehicleVisible ? `${normalizedYaw.toFixed(0)}°` : '—'}</strong></div>
        <div><span>MODE</span><strong>{vehicleVisible ? mode : '—'}</strong></div>
      </div>
      <div className={styles.viewLabel}>
        <Rotate3d size={15} />
        <div>
          <strong>{mapFailed ? '离线坐标视图' : `${sceneContext ? `${sceneContext.sceneName} · ` : ''}二维卫星地图`}</strong>
          <span>{vehicleVisible ? `N ${north.toFixed(1)} m · E ${east.toFixed(1)} m · TRACK ${track.length} pts` : '当前位置尚未确认'}</span>
        </div>
      </div>
    </div>
  );
}
