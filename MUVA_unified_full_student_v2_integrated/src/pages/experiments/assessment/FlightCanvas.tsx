import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { FlightFrame, SimulationSnapshot } from '../../../domain/assessment/model';
import { getExperiment3Scene } from '../../../domain/assessment/experiment3Scenes';
import { IrisDroneModel } from './IrisDroneModel';
import sceneStyles from './Experiment3Scenes.module.css';
type View = 'free' | 'top' | 'side' | 'follow';
interface FlightCanvasProps {
  flight?: SimulationSnapshot;
  scene?: string | null;
  selectedPart?: string;
  onPart?: (id: string) => void;
  demonstration?: 'roll' | 'pitch' | 'yaw' | 'throttle' | null;
  demonstrationPlaying?: boolean;
  focusPart?: boolean;
  trajectory?: FlightFrame[];
  view?: View;
  cognition?: boolean;
  targetAltitude?: number;
}
function Track({ points }: { points: FlightFrame[] }) {
  if (points.length < 2) return null;
  const stride = Math.max(1, Math.ceil(points.length / 450));
  const sampled = points.filter((_, index) => index % stride === 0).map((point) => new THREE.Vector3(point.x, point.y + 0.12, point.z));
  const positions = new Float32Array(sampled.flatMap((point) => [point.x,point.y,point.z]));
  return <line><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]}/></bufferGeometry><lineBasicMaterial color="#23dfff" linewidth={2}/></line>;
}
function Camera({ view, flight, cognition, focusPart, selectedPart }: { view: View; flight?: SimulationSnapshot; cognition?: boolean; focusPart?: boolean; selectedPart?: string }) {
  const { camera, controls } = useThree();
  const previous = useRef(new THREE.Vector3(flight?.position.x ?? 0, flight?.position.y ?? 0, flight?.position.z ?? 0));
  useFrame(() => {
    if (view !== 'follow' || !flight) return;
    const next = new THREE.Vector3(flight.position.x, flight.position.y, flight.position.z);
    const offset = next.clone().sub(previous.current);
    camera.position.add(offset);
    if (controls && 'target' in controls) (controls as THREE.EventDispatcher & { target: THREE.Vector3 }).target.add(offset);
    previous.current.copy(next);
  });
  useEffect(() => {
    const focus: [number, number, number] = cognition ? [0, 1, 0] : [flight?.position.x ?? 0, flight?.position.y ?? 0, flight?.position.z ?? 0];
    previous.current.set(...focus);
    if (view === 'top' || cognition && !focusPart) camera.position.set(focus[0], focus[1] + (cognition ? 17.5 : 95), focus[2] + 0.01);
    else if (cognition && focusPart) camera.position.set(2.5, 2.5, 4);
    else if (view === 'side') camera.position.set(focus[0] + 24, focus[1] + 8, focus[2]);
    else if (view === 'follow') camera.position.set(focus[0] + 9, focus[1] + 8, focus[2] + 13);
    else camera.position.set(cognition ? 3.3 : 7, cognition ? 2.8 : 6, cognition ? 5 : 10);
    camera.lookAt(...focus);
    if (controls && 'target' in controls) (controls as THREE.EventDispatcher & { target: THREE.Vector3 }).target.set(...focus);
  }, [view, cognition, camera, controls, focusPart, selectedPart]);
  return null;
}
export function FlightCanvas({ flight, scene, cognition = false, selectedPart, onPart, demonstration, demonstrationPlaying, focusPart, trajectory = [], view = 'free', targetAltitude }: FlightCanvasProps) {
  const selectedScene = cognition ? undefined : getExperiment3Scene(scene);
  return <div className={sceneStyles.viewport} data-scene-id={selectedScene?.id}>
    {selectedScene && <><img className={sceneStyles.map} src={selectedScene.mapImage} alt={`${selectedScene.name}卫星地图`}/><div className={sceneStyles.mapShade}/></>}
    <Canvas shadows gl={{ alpha: true }} aria-label="可旋转、缩放的 3D Iris 四旋翼" camera={{ position: cognition ? [5, 3.3, 5.5] : [7, 6, 10], fov: cognition ? 43 : 48 }} style={{ height: '100%', width: '100%' }}>
    {cognition && <color attach="background" args={['#061a33']}/>}
    <ambientLight intensity={1.7}/><directionalLight position={[9, 18, 8]} intensity={2.5} castShadow/><pointLight position={[-4, 4, -2]} intensity={2} color="#18b9ef"/>
    <Suspense fallback={null}>
      <group name="experiment3-iris"><IrisDroneModel flight={flight} selectedPart={selectedPart} onPart={onPart} demonstration={demonstration} demonstrationPlaying={demonstrationPlaying} cognition={cognition}/></group>
      {!cognition && <Track points={trajectory}/>}
      {!cognition && trajectory.filter((frame) => frame.event).map((frame) => <mesh key={`${frame.timestamp}-${frame.event}`} position={[frame.x, Math.max(0.2, frame.y), frame.z]}><sphereGeometry args={[0.35, 10, 10]}/><meshBasicMaterial color="#ff6969"/></mesh>)}
      {targetAltitude !== undefined && <group position={cognition ? [1.9, 0, 0] : [3.5, 0, -1]}>
        <mesh position={[0, cognition ? (0.5 + targetAltitude / 24) : targetAltitude / 2, 0]}><cylinderGeometry args={[0.015, 0.015, cognition ? (1 + targetAltitude / 12) : targetAltitude, 8]}/><meshBasicMaterial color="#6deee6"/></mesh>
        <mesh position={[0, cognition ? (1 + targetAltitude / 12) : targetAltitude, 0]}><sphereGeometry args={[0.14, 12, 12]}/><meshBasicMaterial color="#6deee6"/></mesh>
      </group>}
    </Suspense>
    <OrbitControls makeDefault enableDamping minDistance={cognition ? 8 : 5} maxDistance={cognition ? 40 : 160} maxPolarAngle={cognition ? Math.PI * 0.8 : Math.PI / 2.05}/>
    <Camera view={view} flight={flight} cognition={cognition} focusPart={focusPart} selectedPart={selectedPart}/>
    </Canvas>
    {selectedScene && <span className={sceneStyles.credit}>Sentinel-2 © EOX / Copernicus 2016 · CC BY 4.0</span>}
  </div>;
}
