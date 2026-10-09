import type { SceneConfig } from './model';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Experiment3Scene extends SceneConfig {
  type: string;
  previewImage: string;
  mapImage: string;
  description: string;
  trainingGoal: string;
  center: GeoPoint;
  zoom: number;
  home: GeoPoint;
  target: GeoPoint;
  safeRadius: number;
  extentMeters: { width: number; height: number };
}

const map = (center: GeoPoint, homeOffset: { east: number; north: number }, targetPosition: { x: number; z: number }, safeRadius: number, extentMeters: { width: number; height: number }, zoom: number) => {
  const latitudeScale = 111111;
  const longitudeScale = latitudeScale * Math.cos(center.latitude * Math.PI / 180);
  const point = (offset: { east: number; north: number }): GeoPoint => ({
    latitude: center.latitude + offset.north / latitudeScale,
    longitude: center.longitude + offset.east / longitudeScale,
  });
  return { center, zoom, home: point(homeOffset), target: point({ east: homeOffset.east + targetPosition.x, north: homeOffset.north - targetPosition.z }), safeRadius, extentMeters };
};

export const EXPERIMENT3_SCENES: Experiment3Scene[] = [
  {
    id: 'campus', name: '校园训练场', type: '校园',
    previewImage: '/experiment3/scenes/campus-satellite.jpg',
    mapImage: '/experiment3/scenes/campus-satellite.jpg',
    description: '适合基础航线、悬停和校园环境认知训练。',
    trainingGoal: '稳定悬停 · 基础航线 · 环境认知',
    assetId: 'campus', available: true, homePosition: { x: 0, y: 0, z: 0 },
    trainingArea: { width: 65, length: 65 }, targetPosition: { x: 8, z: -10 },
    obstacles: [{ id: 'teaching-block', position: [21, 3, -17], size: [8, 6, 12] }, { id: 'library', position: [-20, 2.5, 12], size: [8, 5, 10] }],
    wind: 2, visibility: 700, size: 65, risk: '中', difficulty: '中级',
    detail: '建筑位于训练区外，需保持障碍距离', color: '#41725b',
    ...map({ latitude: 34.1251589, longitude: 108.8289653 }, { east: -12, north: 8 }, { x: 8, z: -10 }, 32, { width: 90, height: 90 }, 16),
  },
  {
    id: 'city', name: '城市训练场', type: '城市',
    previewImage: '/experiment3/scenes/city-satellite.jpg',
    mapImage: '/experiment3/scenes/city-satellite.jpg',
    description: '适合城市环境航线与复杂区域认知训练。',
    trainingGoal: '航线规划 · 区域识别 · 安全意识',
    assetId: 'runway', available: true, homePosition: { x: 0, y: 0, z: 0 },
    trainingArea: { width: 50, length: 50 }, targetPosition: { x: 0, z: -10 },
    obstacles: [], wind: 3, visibility: 500, size: 50, risk: '高', difficulty: '高级',
    detail: '关注城市密集区域，教学航线限定在模拟安全区域内', color: '#5f7395',
    ...map({ latitude: 31.230416, longitude: 121.473701 }, { east: -10, north: 7 }, { x: 0, z: -10 }, 25, { width: 72, height: 72 }, 15),
  },
  {
    id: 'mountain', name: '山地训练场', type: '山地',
    previewImage: '/experiment3/scenes/mountain-satellite.jpg',
    mapImage: '/experiment3/scenes/mountain-satellite.jpg',
    description: '适合山地区域航线和环境识别训练。',
    trainingGoal: '环境识别 · 高度控制 · 航线训练',
    assetId: 'runway', available: true, homePosition: { x: 0, y: 0, z: 0 },
    trainingArea: { width: 65, length: 65 }, targetPosition: { x: 0, z: -10 },
    obstacles: [], wind: 4, visibility: 500, size: 65, risk: '高', difficulty: '高级',
    detail: '卫星影像用于山地认知，不模拟真实地形高度', color: '#8c7566',
    ...map({ latitude: 30.573096, longitude: 103.923852 }, { east: -8, north: 5 }, { x: 0, z: -10 }, 32, { width: 90, height: 90 }, 14),
  },
  {
    id: 'airport', name: '机场训练场', type: '机场',
    previewImage: '/experiment3/scenes/airport-satellite.jpg',
    mapImage: '/experiment3/scenes/airport-satellite.jpg',
    description: '适合开阔区域起降与标准航线训练。',
    trainingGoal: '标准起降 · 开阔区域 · 标准航线',
    assetId: 'runway', available: true, homePosition: { x: 0, y: 0, z: 0 },
    trainingArea: { width: 80, length: 80 }, targetPosition: { x: 0, z: -10 },
    obstacles: [], wind: 1, visibility: 1000, size: 80, risk: '低', difficulty: '初级',
    detail: '仅作教学环境认知，不代表允许在真实机场飞行', color: '#277488',
    ...map({ latitude: 40.079857, longitude: 116.603112 }, { east: -14, north: 6 }, { x: 0, z: -10 }, 40, { width: 105, height: 105 }, 14),
  },
];

export const getExperiment3Scene = (selectedSceneId: string | null | undefined) =>
  EXPERIMENT3_SCENES.find((scene) => scene.id === selectedSceneId);

export function restoreExperiment3Scene(value: { selectedSceneId?: string | null; scene?: string | null }) {
  const storedId = value.selectedSceneId === undefined ? value.scene : value.selectedSceneId;
  return getExperiment3Scene(storedId === 'runway' ? 'airport' : storedId)?.id ?? null;
}
