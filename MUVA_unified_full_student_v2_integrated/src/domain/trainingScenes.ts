import type { TrainingScene } from '../types/configuration';

export interface SceneAsset {
  image: string;
  center: { latitude: number; longitude: number };
  /** 影像覆盖的地面范围（米）。 */
  extentMeters: number;
  /** 教学安全范围示意半径（米）。 */
  safeRadiusMeters: number;
}

/**
 * 实验一四个训练场的卫星影像基准。
 * 仅用于步骤 3 选场预览；飞行地图使用真实地理瓦片，不使用这些图片铺底。
 */
export const experiment1SceneAssets: Record<string, SceneAsset> = {
  campus: { image: '/experiment3/scenes/campus-satellite.jpg', center: { latitude: 34.1251589, longitude: 108.8289653 }, extentMeters: 90, safeRadiusMeters: 45 },
  city: { image: '/experiment3/scenes/city-satellite.jpg', center: { latitude: 31.230416, longitude: 121.473701 }, extentMeters: 72, safeRadiusMeters: 40 },
  mountain: { image: '/experiment3/scenes/mountain-satellite.jpg', center: { latitude: 30.573096, longitude: 103.923852 }, extentMeters: 90, safeRadiusMeters: 50 },
  airport: { image: '/experiment3/scenes/airport-satellite.jpg', center: { latitude: 40.079857, longitude: 116.603112 }, extentMeters: 105, safeRadiusMeters: 50 },
};

export const sceneAssetFor = (scene: TrainingScene | null): SceneAsset | null =>
  scene ? experiment1SceneAssets[scene.id] ?? null : null;
