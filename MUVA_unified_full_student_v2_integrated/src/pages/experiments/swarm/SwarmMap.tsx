import { useEffect, useRef, useState } from 'react';
import { Ban, Check, Crosshair, Home, MapPinned, MousePointer2, Pentagon, RotateCcw, Square, Trash2, Undo2 } from 'lucide-react';
import { AttributionControl, Map as MapLibreMap, Marker, NavigationControl, ScaleControl, type GeoJSONSource, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { geographicBasemapSourceId, geographicMapStyle } from '../../../domain/geographicMap';
import { origin, polygonCenter, swarmFrame } from '../../../domain/swarmGeometry';
import { missionRegions, swarmColors } from '../../../domain/swarmPlanning';
import { minimumCoverageRectangle } from '../../../domain/swarmCoverage';
import { completeMissionPath } from '../../../domain/swarmMissionWorkflow';
import type { Point, SwarmRun } from '../../../types/swarm';
import styles from './SwarmMap.module.css';

interface Props {
  run: SwarmRun;
  editable?: boolean;
  onArea?: (vertices: Point[]) => void;
  onNoFly?: (vertices: Point[]) => void;
  onHome?: (position: Point) => void;
  onClear?: () => void;
  selected?: string;
  focusRevision?: number;
}
type Tool = 'pan' | 'rectangle' | 'polygon' | 'noFly' | 'home' | 'edit' | 'delete';
const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const rectangle = (first: Point, second: Point): Point[] => [first, [second[0], first[1]], second, [first[0], second[1]]];
const ring = (center: Point, radius: number, sceneOrigin?: Point): Point[] => {
  const { toLocal, toGeo } = swarmFrame(sceneOrigin);
  const local = toLocal(center);
  return Array.from({ length: 65 }, (_, index) => toGeo([local[0] + Math.cos(index * Math.PI / 32) * radius, local[1] + Math.sin(index * Math.PI / 32) * radius]));
};

function droneElement(droneId: string, color: string, selected: boolean) {
  const element = document.createElement('div');
  element.className = `${styles.drone} ${selected ? styles.selected : ''}`;
  element.style.setProperty('--uav-color', color);
  element.setAttribute('aria-label', `${droneId} 无人机位置`);
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 32 32'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.4');
  const frame = document.createElementNS(namespace, 'path');
  frame.setAttribute('d', 'M10 10 22 22 M22 10 10 22 M13 13 H19 V19 H13 Z'); svg.appendChild(frame);
  [[7, 7], [25, 7], [7, 25], [25, 25]].forEach(([east, north]) => {
    const rotor = document.createElementNS(namespace, 'circle');
    rotor.setAttribute('cx', String(east)); rotor.setAttribute('cy', String(north)); rotor.setAttribute('r', '4.5'); svg.appendChild(rotor);
  });
  const label = document.createElement('span'); label.textContent = droneId;
  element.append(svg, label);
  return element;
}

export function SwarmMap({ run, editable = false, onArea, onNoFly, onHome, onClear, selected, focusRevision = 0 }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [basemap, setBasemap] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tool, setTool] = useState<Tool>('pan');
  const [vertices, setVertices] = useState<Point[]>([]);
  const [anchor, setAnchor] = useState<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const [routeScope, setRouteScope] = useState<'all' | 'selected'>('all');
  const [showNumbers, setShowNumbers] = useState(run.step === 3);
  const [allNumbers, setAllNumbers] = useState(true);
  const activeDroneId = selected ?? run.missions[0]?.droneId;
  const drawing = ['polygon', 'rectangle', 'edit', 'delete'].includes(tool);
  const current = useRef({ run, editable, onArea, onNoFly, onHome, tool, vertices, anchor, moving });
  current.current = { run, editable, onArea, onNoFly, onHome, tool, vertices, anchor, moving };
  const cancel = () => { setTool('pan'); setVertices([]); setAnchor(null); setHover(null); setMoving(null); };
  const choose = (next: Tool) => {
    cancel(); setTool(next);
    if ((next === 'edit' || next === 'delete') && run.area) setVertices(run.area.polygon.coordinates[0]!.slice(0, -1));
  };
  const finish = () => { if (vertices.length >= 3) { onArea?.(vertices); cancel(); } };

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, center: current.current.run.config.sceneOrigin ?? origin, zoom: 17.2, minZoom: 13, maxZoom: 19,
      pitch: 0, maxPitch: 0, dragRotate: false, touchPitch: false, attributionControl: false, style: geographicMapStyle() });
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    map.current = instance;
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => instance.resize()); });
    observer.observe(container.current);
    instance.on('sourcedata', (event) => {
      const tile: unknown = event.tile;
      if (event.sourceId === geographicBasemapSourceId && tile && typeof tile === 'object' && 'state' in tile && tile.state === 'loaded') setBasemap('ready');
    });
    instance.on('error', (event) => {
      const failure: unknown = event.error;
      if ('sourceId' in event && event.sourceId === geographicBasemapSourceId
        || failure && typeof failure === 'object' && 'url' in failure && typeof failure.url === 'string' && failure.url.includes('World_Imagery')) setBasemap('error');
    });
    const addLayers = () => {
      if (instance.getSource('swarm')) return;
      instance.addSource('swarm', { type: 'geojson', data: collection([]) });
      instance.addLayer({ id: 'swarm-fill', type: 'fill', source: 'swarm', filter: ['in', ['get', 'kind'], ['literal', ['area', 'noFly', 'safety', 'draft', 'draftFill']]],
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'kind'], 'safety'], 0.09, ['==', ['get', 'kind'], 'noFly'], 0.32, ['==', ['get', 'kind'], 'area'], 0.38, 0.23] } });
      instance.addLayer({ id: 'swarm-area-halo', type: 'line', source: 'swarm', filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'line-color': '#06253e', 'line-width': 7, 'line-opacity': 0.85 } });
      instance.addLayer({ id: 'swarm-outline', type: 'line', source: 'swarm', filter: ['in', ['get', 'kind'], ['literal', ['area', 'noFly', 'safety', 'draft', 'draftLine']]],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'kind'], 'safety'], 1, ['==', ['get', 'kind'], 'area'], 3.5, 2], 'line-opacity': 0.98 } });
      instance.addLayer({ id: 'swarm-coverage-outline', type: 'line', source: 'swarm', filter: ['in', ['get', 'kind'], ['literal', ['drawnBoundary', 'coverageBoundary']]],
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-dasharray': [3, 2], 'line-opacity': 1 } });
      instance.addLayer({ id: 'swarm-transit', type: 'line', source: 'swarm', filter: ['==', ['get', 'kind'], 'transit'],
        paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 2.2, 1.5], 'line-opacity': ['case', ['get', 'selected'], 0.95, 0.6], 'line-dasharray': [2, 3] } });
      instance.addLayer({ id: 'swarm-mission', type: 'line', source: 'swarm', filter: ['==', ['get', 'kind'], 'mission'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.95 } });
      instance.addLayer({ id: 'swarm-trajectory', type: 'line', source: 'swarm', filter: ['==', ['get', 'kind'], 'trajectory'],
        paint: { 'line-color': ['get', 'color'], 'line-width': 3 } });
      instance.addLayer({ id: 'swarm-waypoints', type: 'circle', source: 'swarm', filter: ['==', ['get', 'kind'], 'waypoint'],
        paint: { 'circle-radius': 2.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#09263a', 'circle-stroke-width': 1 } });
      instance.addLayer({ id: 'swarm-vertices', type: 'circle', source: 'swarm', filter: ['==', ['get', 'kind'], 'vertex'],
        paint: { 'circle-radius': 5, 'circle-color': '#eefbff', 'circle-stroke-color': '#18baff', 'circle-stroke-width': 2 } });
      setReady(true);
    };
    instance.on('style.load', addLayers);
    instance.on('click', (event: MapMouseEvent) => {
      const state = current.current;
      if (!state.editable) return;
      const point: Point = [event.lngLat.lng, event.lngLat.lat];
      if (state.tool === 'home') { state.onHome?.(point); cancel(); }
      if (state.tool === 'polygon') {
        if (event.originalEvent.detail > 1 || state.vertices.length >= 3 && instance.project(state.vertices[0]!).dist(event.point) < 14) return;
        if (!state.vertices.length || instance.project(state.vertices.at(-1)!).dist(event.point) > 4) {
          const next = [...state.vertices, point];
          current.current.vertices = next;
          setVertices(next);
        }
      }
      if (state.tool === 'rectangle' || state.tool === 'noFly') {
        if (!state.anchor) setAnchor(point);
        else { (state.tool === 'noFly' ? state.onNoFly : state.onArea)?.(rectangle(state.anchor, point)); cancel(); }
      }
      if (state.tool === 'edit' || state.tool === 'delete') {
        if (state.tool === 'edit' && state.moving !== null) {
          setVertices(state.vertices.map((vertex, index) => index === state.moving ? point : vertex)); setMoving(null); return;
        }
        const nearest = state.vertices.findIndex((vertex) => instance.project(vertex).dist(event.point) < 20);
        if (nearest < 0) return;
        if (state.tool === 'edit') setMoving(nearest);
        else if (state.vertices.length > 3) setVertices(state.vertices.filter((_, index) => index !== nearest));
      }
    });
    instance.on('dblclick', (event: MapMouseEvent) => {
      const state = current.current;
      if (!state.editable || state.tool !== 'polygon') return;
      event.preventDefault();
      if (state.vertices.length < 3) return;
      state.onArea?.(state.vertices);
      cancel();
    });
    instance.on('mousemove', (event) => { if (current.current.anchor || current.current.tool === 'polygon') setHover([event.lngLat.lng, event.lngLat.lat]); });
    instance.on('contextmenu', (event) => { if (current.current.tool !== 'pan') { event.preventDefault(); cancel(); } });
    return () => {
      observer.disconnect(); cancelAnimationFrame(resizeFrame);
      markers.current.forEach((marker) => marker.remove()); markers.current = [];
      instance.remove(); map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !instance.getSource('swarm')) return;
    instance.getCanvas().style.cursor = tool === 'pan' ? '' : 'crosshair';
    const features: GeoJSON.Feature[] = [];
    const visibleArea = tool === 'polygon' || tool === 'rectangle' ? null : run.area;
    const regions = visibleArea && !drawing ? missionRegions(run) : [];
    if (visibleArea && !regions.length) features.push({ type: 'Feature', geometry: visibleArea.polygon, properties: { kind: 'area', color: swarmColors[0] } });
    regions.forEach((region) => features.push({ type: 'Feature', geometry: region.polygon, properties: { kind: 'area', color: region.color } }));
    if (visibleArea && regions.length) {
      features.push({ type: 'Feature', geometry: visibleArea.polygon, properties: { kind: 'drawnBoundary', color: '#00dcff' } });
      features.push({ type: 'Feature', geometry: minimumCoverageRectangle(visibleArea, run.config.sceneOrigin).polygon,
        properties: { kind: 'coverageBoundary', color: '#ffde7b' } });
    }
    run.planning?.noFlyZones.forEach((zone) => features.push({ type: 'Feature', geometry: zone.polygon, properties: { kind: 'noFly', color: '#ff535d' } }));
    const draft = anchor && hover ? rectangle(anchor, hover) : vertices;
    const draftLine = tool === 'polygon' && hover && vertices.length ? [...vertices, hover] : vertices;
    if (draftLine.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: draftLine }, properties: { kind: 'draftLine', color: '#b7f3ff' } });
    if (draft.length >= 3) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...draft, draft[0]!]] }, properties: { kind: tool === 'polygon' ? 'draftFill' : 'draft', color: tool === 'noFly' ? '#ff535d' : '#b7f3ff' } });
    (draft.length ? draft : visibleArea?.polygon.coordinates[0]?.slice(0, -1) ?? []).forEach((point) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { kind: 'vertex' } }));
    const displayedMissions = drawing ? [] : run.missions.filter((mission) => routeScope === 'all' || mission.droneId === activeDroneId);
    displayedMissions.forEach((mission) => {
      const coverage = mission.waypoints.slice(mission.coverageStartIndex ?? 0);
      const drone = run.snapshot?.drones.find((item) => item.droneId === mission.droneId);
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coverage }, properties: { kind: 'mission', color: mission.assignedColor } });
      const paths = [mission.entryPath, mission.returnPath].filter((path): path is Point[] => !!path && path.length > 1);
      if (paths.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: paths }, properties: { kind: 'transit', color: mission.assignedColor, selected: mission.droneId === activeDroneId } });
      completeMissionPath(mission, drone).forEach((point, index) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { kind: 'waypoint', number: index + 1, droneId: mission.droneId, color: mission.assignedColor } }));
    });
    run.snapshot?.drones.forEach((drone, index) => {
      features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(drone.position, run.config.safety / 2, run.config.sceneOrigin)] }, properties: { kind: 'safety', color: swarmColors[index]! } });
      if (drone.trajectory.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: drone.trajectory }, properties: { kind: 'trajectory', color: swarmColors[index]! } });
    });
    (instance.getSource('swarm') as GeoJSONSource).setData(collection(features));
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    if (showNumbers) displayedMissions.filter((mission) => allNumbers || mission.droneId === activeDroneId).forEach((mission) => {
      const drone = run.snapshot?.drones.find((item) => item.droneId === mission.droneId);
      const path = completeMissionPath(mission, drone);
      const positions = new Map<string, { point: Point; numbers: number[] }>();
      path.forEach((point, index) => {
        const key = point.map((value) => value.toFixed(9)).join(',');
        const existing = positions.get(key);
        if (existing) existing.numbers.push(index + 1);
        else positions.set(key, { point, numbers: [index + 1] });
      });
      positions.forEach(({ point, numbers }) => {
        const element = document.createElement('div');
        const home = numbers.includes(1) || numbers.includes(path.length);
        element.className = `${styles.waypointLabel} ${home ? styles.homeWaypoint : ''}`;
        element.style.setProperty('--uav-color', mission.assignedColor);
        element.textContent = `${home ? 'H ' : ''}${numbers.join('/')}`;
        element.title = `${mission.droneId} · ${home ? '服务 Home · ' : ''}航点 ${numbers.join('/')} · ENU (${swarmFrame(run.config.sceneOrigin).toLocal(point).map((value) => value.toFixed(1)).join(', ')}) m`;
        element.setAttribute('aria-label', element.title);
        element.dataset.waypointDrone = mission.droneId;
        element.dataset.waypointNumber = numbers.join('/');
        markers.current.push(new Marker({ element, anchor: 'center', offset: home ? [-32, -20] : [0, 0] }).setLngLat(point).addTo(instance));
      });
    });
    const label = (text: string, className: string, point: Point, color?: string) => {
      const element = document.createElement('div'); element.className = className; element.textContent = text;
      if (color) element.style.setProperty('--uav-color', color);
      markers.current.push(new Marker({ element, anchor: 'center' }).setLngLat(point).addTo(instance));
    };
    regions.forEach((region) => {
      const points = region.polygon.coordinates[0]!.slice(0, -1);
      const center = polygonCenter(points, run.config.sceneOrigin);
      label(`${region.name}\n${(region.area / 10000).toFixed(2)} ha`, styles.regionLabel!, center, region.color);
    });
    if (visibleArea && !regions.length) {
      const bounds = visibleArea.boundingBox;
      label(`任务区域\n${(visibleArea.area / 10000).toFixed(2)} ha`, styles.regionLabel!, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2], swarmColors[0]);
    }
    run.planning?.noFlyZones.forEach((zone) => {
      const bounds = zone.boundingBox;
      label('⊘ 禁飞区', styles.noFlyLabel!, [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]);
    });
    const home = run.config.homePosition ?? run.snapshot?.drones[0]?.homePosition;
    if (home) {
      const element = document.createElement('div'); element.className = styles.homeAnchor!;
      element.setAttribute('aria-label', 'Home 起降点');
      const icon = document.createElement('span'); icon.className = styles.homeIcon!; icon.textContent = '⌂';
      element.append(icon);
      markers.current.push(new Marker({ element, anchor: 'center' }).setLngLat(home).addTo(instance));
    }
    const drones = run.snapshot?.drones ?? [];
    drones.forEach((drone, index) => {
      const element = droneElement(drone.droneId, swarmColors[index]!, drone.droneId === selected);
      element.style.setProperty('--label-offset', `${28 + index % 3 * 20}px`);
      markers.current.push(new Marker({ element, anchor: 'center' }).setLngLat(drone.position).addTo(instance));
    });
  }, [ready, run.area, run.config, run.missions, run.planning, run.snapshot, vertices, anchor, hover, tool, selected, editable, routeScope, showNumbers, allNumbers, activeDroneId]);

  useEffect(() => {
    if (!ready || !selected) return;
    const drone = current.current.run.snapshot?.drones.find((item) => item.droneId === selected);
    if (drone) map.current?.flyTo({ center: drone.position, zoom: 18.8, duration: 650, padding: 0 });
  }, [ready, selected, focusRevision]);

  const fit = () => {
    if (!map.current) return;
    const fleet = run.snapshot?.drones.map((drone) => [drone.position[0], drone.position[1], drone.position[0], drone.position[1]]) ?? [];
    if (!run.area && !fleet.length) { map.current.flyTo({ center: run.config.sceneOrigin ?? origin, zoom: 17.2, padding: 0 }); return; }
    const home = run.config.homePosition;
    const paths = run.missions.flatMap((mission) => completeMissionPath(mission, run.snapshot?.drones.find((drone) => drone.droneId === mission.droneId))).map((point) => [point[0], point[1], point[0], point[1]]);
    const footprint = run.area && run.missions.length ? minimumCoverageRectangle(run.area, run.config.sceneOrigin).polygon.coordinates[0]!.map((point) => [point[0], point[1], point[0], point[1]]) : [];
    const points = [...(run.area ? [run.area.boundingBox] : []), ...footprint, ...fleet, ...paths, ...(run.planning?.noFlyZones.map((zone) => zone.boundingBox) ?? []), ...(home ? [[home[0], home[1], home[0], home[1]]] : [])];
    map.current.fitBounds([[Math.min(...points.map((point) => point[0]!)), Math.min(...points.map((point) => point[1]!))], [Math.max(...points.map((point) => point[2]!)), Math.max(...points.map((point) => point[3]!))]], { padding: { top: 90, bottom: 125, left: 60, right: 85 }, maxZoom: 18.5, duration: 600 });
  };
  useEffect(() => { if (ready) fit(); }, [ready, run.area, !!run.snapshot, run.config.homePosition, run.missions]);
  useEffect(() => {
    if (!ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => { clearTimeout(timer); timer = setTimeout(fit, 160); };
    window.addEventListener('resize', resize);
    return () => { window.removeEventListener('resize', resize); clearTimeout(timer); };
  }, [ready, run.area, run.config.homePosition, run.planning]);
  const hint = tool === 'polygon' ? `单击添加顶点（${vertices.length}），双击完成 / Enter 完成 / Esc 取消`
    : tool === 'rectangle' || tool === 'noFly' ? `${tool === 'noFly' ? '禁飞区' : '任务矩形'}：${anchor ? '选择对角点完成绘制' : '选择第一个角点'}`
    : tool === 'home' ? '单击设置规划 Home；不修改服务返回的无人机初始位置与返航点'
    : tool === 'edit' ? moving === null ? '选择顶点，再点击新位置；完成后点击「完成绘制」' : '点击地图放置所选顶点'
    : tool === 'delete' ? '点击顶点删除，至少保留三个顶点，然后完成绘制' : '滚轮缩放 · 拖动平移 · 右键取消绘制';

  return <div className={styles.viewport} data-basemap-status={basemap} data-drone-count={run.snapshot?.drones.length ?? 0} data-draft-vertex-count={vertices.length} data-planning-stage={run.missions.length ? 'planned' : run.area ? 'drawn' : 'empty'} data-visible-mission-count={drawing ? 0 : routeScope === 'all' ? run.missions.length : run.missions.filter((mission) => mission.droneId === activeDroneId).length} data-complete-route-count={drawing ? 0 : routeScope === 'all' ? run.missions.length : run.missions.filter((mission) => mission.droneId === activeDroneId).length}
    onKeyDown={(event) => { if (event.key === 'Escape') cancel(); if (event.key === 'Enter' && event.target instanceof HTMLElement && !event.target.closest('button,summary,input,select,a')) finish(); }} tabIndex={0} aria-label="机群区域规划交互地图">
    {editable && <div className={styles.toolbar} aria-label="地图规划工具">
      <button type="button" className={tool === 'polygon' ? styles.active : ''} aria-pressed={tool === 'polygon'} onClick={() => choose('polygon')}><Pentagon size={15} />绘制区域</button>
      <button type="button" className={tool === 'noFly' ? styles.active : ''} aria-pressed={tool === 'noFly'} onClick={() => choose('noFly')}><Ban size={15} className={styles.danger} />添加禁飞区</button>
      <button type="button" className={tool === 'home' ? styles.active : ''} aria-pressed={tool === 'home'} onClick={() => choose('home')}><Home size={15} />设置起降点</button>
      <button type="button" onClick={() => { if (window.confirm('清空任务区域、禁飞区、起降点及航线？')) { cancel(); onClear?.(); } }}><Trash2 size={15} className={styles.danger} />清除全部</button>
      <details className={styles.more}><summary>更多工具</summary><div>
        <button type="button" onClick={() => choose('rectangle')}><Square size={15} />快速绘制矩形</button>
        <button type="button" disabled={!run.area} onClick={() => choose('edit')}><MousePointer2 size={15} />编辑顶点</button>
        <button type="button" disabled={!run.area} onClick={() => choose('delete')}><Trash2 size={15} />删除顶点</button>
        <button type="button" disabled={!run.area} onClick={() => { cancel(); onArea?.([]); }}><RotateCcw size={15} />重置任务区域</button>
      </div></details>
      {(tool === 'polygon' || tool === 'edit' || tool === 'delete') && <>
        <button type="button" disabled={vertices.length < 3} onClick={finish}><Check size={15} />完成绘制</button>
        <button type="button" disabled={!vertices.length} onClick={() => setVertices(vertices.slice(0, -1))}><Undo2 size={15} />撤销顶点</button>
      </>}
    </div>}
    <div className={styles.canvas} ref={container} aria-label="校园训练区二维卫星地图" />
    {!!run.missions.length && !drawing && <div className={styles.routeTools} aria-label="完整航线显示选项">
      <button type="button" aria-pressed={routeScope === 'all'} onClick={() => setRouteScope('all')}>全部完整航线</button>
      <button type="button" aria-pressed={routeScope === 'selected'} onClick={() => setRouteScope('selected')}>仅所选航线</button>
      <label><input type="checkbox" checked={showNumbers} onChange={(event) => setShowNumbers(event.target.checked)} />航点编号</label>
      {showNumbers && <label><input type="checkbox" checked={allNumbers} onChange={(event) => setAllNumbers(event.target.checked)} />全部编号</label>}
    </div>}
    <div className={styles.mapStatus}><span className={basemap === 'ready' ? styles.loaded : styles.waiting} />{basemap === 'ready' ? '卫星影像 · 2D / WGS84' : basemap === 'error' ? '卫星影像加载失败，规划工具仍可用' : '正在加载卫星影像…'}
      {basemap === 'error' && <button type="button" onClick={() => { setBasemap('loading'); setReady(false); map.current?.setStyle(geographicMapStyle(), { diff: false }); }}><RotateCcw size={12} />重试</button>}
    </div>
    <div className={styles.compass} aria-hidden="true"><b>N</b><span>▲</span></div>
    {(run.config.homePosition ?? run.snapshot?.drones[0]?.homePosition) && <div className={styles.homeInfo}><Home size={13} /><span>Home · {run.config.homePosition ? '规划参考点' : '服务起降点'}</span><small>{swarmFrame(run.config.sceneOrigin).toLocal((run.config.homePosition ?? run.snapshot!.drones[0]!.homePosition)).map((value) => value.toFixed(1)).join(', ')} m</small></div>}
    <div className={styles.legend}><span><i style={{ background: swarmColors[0] }} />{run.missions.length && !drawing ? '矩形覆盖分区' : '任务区域'}</span>{!!run.missions.length && !drawing && <><span><i style={{ background: '#00dcff' }} />原绘制边界</span><span><i style={{ background: '#ffde7b' }} />最小外接矩形</span></>}<span><i style={{ background: '#ff535d' }} />禁飞区</span><span>◎ 安全圈 r = {run.config.safety / 2} m</span></div>
    <button className={styles.fit} type="button" onClick={fit}><Crosshair size={16} />回到任务区域</button>
    <div className={styles.footer} role="status"><MapPinned size={13} /><span>WGS84 / ENU</span><span>{hint}</span></div>
  </div>;
}
