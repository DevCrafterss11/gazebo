import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { homes, origin } from '../../../domain/swarmGeometry';
import type { Point, SwarmRun } from '../../../types/swarm';
import styles from './Swarm.module.css';

interface Props { run: SwarmRun; editable?: boolean; onArea?: (vertices: Point[]) => void; selected?: string; }
const featureCollection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
export function SwarmMap({ run, editable = false, onArea, selected }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [vertices, setVertices] = useState<Point[]>([]);
  const [mode, setMode] = useState<'pan' | 'polygon' | 'rectangle' | 'edit' | 'delete'>('pan');
  const [anchor, setAnchor] = useState<Point | null>(null);
  const onAreaRef = useRef(onArea);
  onAreaRef.current = onArea;
  const verticesRef = useRef(vertices); verticesRef.current = vertices;
  const modeRef = useRef(mode); modeRef.current = mode;
  const anchorRef = useRef(anchor); anchorRef.current = anchor;

  useEffect(() => {
    if (!editable) return;
    const selectTool = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const tool: unknown = event.detail;
      if (tool === 'polygon' || tool === 'rectangle') { setVertices([]); setAnchor(null); setMode(tool); }
      if ((tool === 'edit' || tool === 'delete') && run.area) { setVertices(run.area.polygon.coordinates[0]!.slice(0, -1)); setMode(tool); }
      if (tool === 'reset') { setVertices([]); setAnchor(null); setMode('pan'); }
    };
    window.addEventListener('swarm-map-tool', selectTool);
    return () => window.removeEventListener('swarm-map-tool', selectTool);
  }, [editable, run.area]);

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({ container: container.current, center: origin, zoom: 17.8, attributionControl: false,
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'base', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.6, 'raster-contrast': 0.13, 'raster-brightness-max': 0.8 } }] } });
    map.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    instance.on('load', () => {
      instance.addSource('swarm', { type: 'geojson', data: featureCollection([]) });
      instance.addLayer({ id: 'swarm-fill', type: 'fill', source: 'swarm', filter: ['==', ['get', 'kind'], 'area'], paint: { 'fill-color': '#08a9ff', 'fill-opacity': 0.31 } });
      instance.addLayer({ id: 'swarm-lines', type: 'line', source: 'swarm', filter: ['!=', ['get', 'kind'], 'area'], paint: { 'line-color': ['coalesce', ['get', 'color'], '#08a9ff'], 'line-width': ['case', ['==', ['get', 'kind'], 'trajectory'], 4, 2.5], 'line-opacity': ['case', ['==', ['get', 'kind'], 'mission'], 0.82, 1] } });
      instance.addLayer({ id: 'swarm-outline', type: 'line', source: 'swarm', filter: ['==', ['get', 'kind'], 'area'], paint: { 'line-color': '#73eaff', 'line-width': 2.5, 'line-dasharray': [2, 2] } });
      instance.addLayer({ id: 'swarm-vertices', type: 'circle', source: 'swarm', filter: ['==', ['get', 'kind'], 'vertex'], paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#0fbaff' } });
    });
    instance.on('click', (event: MapMouseEvent) => {
      const point: Point = [event.lngLat.lng, event.lngLat.lat]; const current = verticesRef.current;
      if (modeRef.current === 'polygon') setVertices([...current, point]);
      if ((modeRef.current === 'edit' || modeRef.current === 'delete') && current.length) {
        const nearest = current.reduce((best, vertex, index) => Math.hypot(vertex[0] - point[0], vertex[1] - point[1]) < Math.hypot(current[best]![0] - point[0], current[best]![1] - point[1]) ? index : best, 0);
        setVertices(modeRef.current === 'delete' ? current.filter((_, index) => index !== nearest) : current.map((vertex, index) => index === nearest ? point : vertex));
      }
      if (modeRef.current === 'rectangle') {
        if (!anchorRef.current) setAnchor(point);
        else { const [west, south] = anchorRef.current; onAreaRef.current?.([[west, south], [point[0], south], point, [west, point[1]]]); setAnchor(null); setMode('pan'); }
      }
    });
    return () => { observer.disconnect(); markers.current.forEach((marker) => marker.remove()); markers.current = []; instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const draw = () => {
      const features: GeoJSON.Feature[] = [];
      if (run.area) features.push({ type: 'Feature', geometry: run.area.polygon, properties: { kind: 'area' } });
      if (vertices.length > 2) features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...vertices, vertices[0]!] ] }, properties: { kind: 'area' } });
      (vertices.length ? vertices : run.area?.polygon.coordinates[0]?.slice(0, -1) ?? []).forEach((point) => features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: point }, properties: { kind: 'vertex' } }));
      if (vertices.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: vertices }, properties: { color: '#ffc13d' } });
      run.missions.forEach((mission) => {
        features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: mission.coverageSegments }, properties: { color: mission.assignedColor, kind: 'mission' } });
        features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [run.snapshot?.drones.find((drone) => drone.droneId === mission.droneId)?.homePosition ?? origin, ...mission.waypoints] }, properties: { color: mission.assignedColor, kind: 'mission' } });
      });
      run.snapshot?.drones.forEach((drone) => { if (drone.trajectory.length > 1) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: drone.trajectory }, properties: { color: run.missions.find((mission) => mission.droneId === drone.droneId)?.assignedColor ?? '#fff', kind: 'trajectory' } }); });
      const source = instance.getSource('swarm') as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined;
      source?.setData(featureCollection(features));
    };
    if (instance.isStyleLoaded()) draw(); else instance.once('load', draw);
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    const previews = run.snapshot?.drones ?? homes(run.config.count).map((homePosition, index) => ({ droneId: `UAV-${String(index + 1).padStart(2, '0')}`, state: 'READY', position: homePosition }));
    previews.forEach((drone) => {
      const element = document.createElement('span'); element.className = styles.marker!;
      element.style.borderColor = run.missions.find((mission) => mission.droneId === drone.droneId)?.assignedColor ?? ['#08a9ff', '#21e89c', '#ffaf29', '#ba6dff', '#ff6c92'][Number(drone.droneId.slice(-2)) - 1] ?? '#08a9ff';
      element.textContent = drone.droneId.replace('UAV-', ''); element.title = `${drone.droneId} · ${drone.state}`;
      if (drone.droneId === selected) element.classList.add(styles.selectedMarker!);
      markers.current.push(new Marker({ element }).setLngLat(drone.position).addTo(instance));
    });
  }, [run.area, run.missions, run.snapshot, run.config.count, vertices, selected]);

  return <div className={styles.mapWrap}>
    {editable && <div className={styles.mapTools}>
      <button type="button" onClick={() => { setMode('polygon'); setVertices([]); }}>绘制多边形</button>
      <button type="button" onClick={() => { setMode('rectangle'); setAnchor(null); }}>绘制矩形</button>
      <button type="button" disabled={!vertices.length} onClick={() => setVertices(vertices.slice(0, -1))}>删除末尾顶点</button>
      <button type="button" disabled={vertices.length < 3} onClick={() => { onArea?.(vertices); setMode('pan'); setVertices([]); }}>完成绘制</button>
      <button type="button" disabled={!run.area} onClick={() => { setMode('edit'); setVertices(run.area!.polygon.coordinates[0]!.slice(0, -1)); }}>编辑顶点</button>
      <button type="button" disabled={vertices.length < 4 && !run.area} onClick={() => { if (!vertices.length && run.area) setVertices(run.area.polygon.coordinates[0]!.slice(0, -1)); setMode('delete'); }}>删除最近顶点</button>
      <button type="button" onClick={() => { setVertices([]); setAnchor(null); setMode('pan'); onArea?.([]); }}>重置区域</button>
    </div>}
    <div className={styles.map} ref={container} aria-label="机群规划地图" />
    <div className={styles.mapFooter}><span>WGS84 · 校园训练场景 · {mode === 'polygon' ? `点击地图添加顶点（${vertices.length}）` : mode === 'edit' ? '点击地图移动最近的顶点，完成绘制后保存' : mode === 'delete' ? '点击地图删除最近的顶点' : mode === 'rectangle' ? '点击两个对角点' : '拖动平移 · 滚轮缩放'}</span><button type="button" onClick={() => map.current?.flyTo({ center: origin, zoom: 17.8 })}>回到场景</button></div>
  </div>;
}
