import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl, ScaleControl, AttributionControl, type MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { geographicMapStyle } from '../../../domain/geographicMap';
import { origin, swarmFrame } from '../../../domain/swarmGeometry';
import type { Mission } from '../../../types/collaboration';
import type { Point } from '../../../types/swarm';
import styles from './CollaborationMap.module.css';

interface CollaborationMapProps {
  mission: Mission;
  selectedGroupId: string;
  selectedDrone: string | null;
  mapPoints: Point[];
  drawing: boolean;
  onDroneClick: (droneId: string) => void;
  onMapClick: (point: Point) => void;
}

const targetPosition = (groupIndex: number): Point => swarmFrame(origin).toGeo([(groupIndex - 2) * 42, 68]);

function droneElement(name: string, color: string, selected: boolean, status: string, onSelect: () => void) {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = `${styles.geoDrone} ${selected ? styles.geoDroneSelected : ''}`;
  element.style.setProperty('--group-color', color);
  element.title = `${name} · ${status}`;
  element.setAttribute('aria-label', `${name} · ${status}`);
  element.innerHTML = '<span aria-hidden="true">✣</span><b></b>';
  const label = element.querySelector('b');
  if (label) label.textContent = name;
  element.addEventListener('click', (event) => { event.stopPropagation(); onSelect(); });
  return element;
}

export function CollaborationMap({ mission, selectedGroupId, selectedDrone, mapPoints, drawing, onDroneClick, onMapClick }: CollaborationMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [baseStatus, setBaseStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const current = useRef({ drawing, onMapClick });
  current.current = { drawing, onMapClick };

  useEffect(() => {
    if (!container.current) return;
    const instance = new MapLibreMap({
      container: container.current,
      center: origin,
      zoom: 17.2,
      minZoom: 13,
      maxZoom: 19,
      pitch: 0,
      maxPitch: 0,
      dragRotate: false,
      touchPitch: false,
      attributionControl: false,
      style: geographicMapStyle(),
    });
    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right');
    instance.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);
    instance.on('click', (event: MapMouseEvent) => {
      if (current.current.drawing) current.current.onMapClick([event.lngLat.lng, event.lngLat.lat]);
    });
    instance.on('sourcedata', (event) => {
      const tile: unknown = event.tile;
      if (event.sourceId === 'geographic-basemap' && tile && typeof tile === 'object' && 'state' in tile && tile.state === 'loaded') setBaseStatus('ready');
    });
    instance.on('error', (event) => {
      if (event.error.message.includes('services.arcgisonline.com')) setBaseStatus('error');
    });
    instance.on('load', () => setReady(true));
    map.current = instance;
    return () => {
      observer.disconnect();
      markers.current.forEach((marker) => marker.remove());
      markers.current = [];
      instance.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;
    instance.getCanvas().style.cursor = drawing ? 'crosshair' : '';
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    const marker = (element: HTMLElement, point: Point, anchor: 'center' | 'bottom' = 'center') => {
      markers.current.push(new Marker({ element, anchor }).setLngLat(point).addTo(instance));
    };

    mission.tasks.forEach((task, index) => {
      const group = mission.groups.find((item) => item.taskId === task.id);
      if (!group) return;
      const element = document.createElement('div');
      element.className = `${styles.geoTaskTarget} ${group.id === selectedGroupId ? styles.geoTaskTargetActive : ''}`;
      element.style.setProperty('--group-color', group.color);
      const name = document.createElement('b');
      name.textContent = task.name;
      const count = document.createElement('small');
      count.textContent = `${group.drones.length} 架 · ${Math.round(group.progress)}%`;
      element.append(name, count);
      marker(element, targetPosition(index), 'bottom');
    });

    mission.drones.forEach((drone) => {
      const groupIndex = mission.groups.findIndex((group) => group.id === drone.taskGroupId);
      const group = mission.groups[groupIndex];
      const color = group?.color ?? '#41d5ed';
      const element = droneElement(drone.name, color, selectedDrone === drone.id, drone.status, () => onDroneClick(drone.id));
      if (selectedGroupId && drone.taskGroupId !== selectedGroupId) element.classList.add(styles.geoDroneInactive!);
      marker(element, swarmFrame(origin).toGeo([drone.position.x, drone.position.y]));
    });

    mapPoints.forEach((point, index) => {
      const element = document.createElement('span');
      element.className = styles.geoUserPoint!;
      element.textContent = String(index + 1);
      marker(element, point);
    });
  }, [ready, mission, selectedGroupId, selectedDrone, mapPoints, drawing, onDroneClick]);

  return <div className={`${styles.collaborationMap} ${drawing ? styles.mapDrawing : ''}`}>
    <div className={styles.geoMapCanvas} ref={container} />
    <div className={styles.geoMapHeader}><span>共享卫星地图 · 单一任务空域</span><small>15 架无人机 · 5 个独立任务</small></div>
    <div className={styles.mapOverview}><span><b>{mission.drones.filter((drone) => drone.status !== 'FAILED').length}</b>在线无人机</span><span><b>{mission.groups.filter((group) => group.status === 'RUNNING').length}</b>执行中任务</span><span><b>{mission.groups.filter((group) => group.status === 'COMPLETE').length}</b>已完成任务</span><span><b>{mission.drones.filter((drone) => drone.status === 'FAILED').length}</b>当前告警</span></div>
    <div className={styles.geoMapStatus}><i className={baseStatus === 'ready' ? styles.geoMapReady : baseStatus === 'error' ? styles.geoMapError : ''} />{baseStatus === 'ready' ? '卫星影像已加载' : baseStatus === 'error' ? '卫星影像加载失败' : '正在加载卫星影像'}</div>
    <div className={styles.mapLegend}><span><i className={styles.legendDrone} />无人机</span><span><i className={styles.legendTarget} />任务目标</span><small>{drawing ? '点击地图添加任务点位' : '点击无人机查看状态'}</small></div>
  </div>;
}
