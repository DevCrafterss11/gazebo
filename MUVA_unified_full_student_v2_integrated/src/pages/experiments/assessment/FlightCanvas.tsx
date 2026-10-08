import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { FlightFrame, SimulationSnapshot } from '../../../domain/assessment/model';
import { scenes } from '../../../domain/assessment/model';
import { IrisDroneModel } from './IrisDroneModel';

type View = 'free' | 'top' | 'side' | 'follow';
interface FlightCanvasProps {
  flight?: SimulationSnapshot;
  scene?: string | null;
  selectedPart?: string;
  onPart?: (id: string) => void;
  demonstration?: 'roll' | 'pitch' | 'yaw' | null;
  trajectory?: FlightFrame[];
  view?: View;
  cognition?: boolean;
  targetAltitude?: number;
}
function Ground({ scene }: { scene: string }) {
  const config = scenes.find((item) => item.id === scene) ?? scenes[0]!;
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.03, 0]}><planeGeometry args={[110,110]}/><meshStandardMaterial color={config.color} roughness={0.96}/></mesh>
    <gridHelper args={[100, 50, '#1a9cb9', '#244863']} position={[0, 0, 0]}/>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}><planeGeometry args={[12,72]}/><meshStandardMaterial color="#263443"/></mesh>
    {[[-5.85,0],[5.85,0]].map(([x,z]) => <mesh key={x} rotation={[-Math.PI/2,0,0]} position={[x!,0.025,z!]}><planeGeometry args={[0.16,72]}/><meshBasicMaterial color="#d4e1e7"/></mesh>)}
    {Array.from({ length: 11 }, (_, index) => <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.022, index * 6 - 30]}><planeGeometry args={[0.28, 2.5]}/><meshBasicMaterial color="#b9d9ef"/></mesh>)}
    {Array.from({ length: 10 },(_,index) => <group key={index} position={[index%2 ? -18 : 18,0,index*8-36]}><mesh position={[0,1.3,0]}><boxGeometry args={[2.4,2.6,3.5]}/><meshStandardMaterial color={index%2 ? '#47667a' : '#537b71'}/></mesh><mesh position={[0,2.65,0]}><boxGeometry args={[2.6,0.15,3.7]}/><meshStandardMaterial color="#12324b"/></mesh></group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.038,0]}><planeGeometry args={[config.size,config.size]}/><meshBasicMaterial color="#43d5a5" opacity={0.035} transparent depthWrite={false}/></mesh>
    {[-1,1].flatMap((side) => [<mesh key={`x${side}`} rotation={[-Math.PI/2,0,0]} position={[side*config.size/2,0.045,0]}><planeGeometry args={[0.18,config.size]}/><meshBasicMaterial color="#38eeba"/></mesh>,<mesh key={`z${side}`} rotation={[-Math.PI/2,0,0]} position={[0,0.045,side*config.size/2]}><planeGeometry args={[config.size,0.18]}/><meshBasicMaterial color="#38eeba"/></mesh>])}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}><ringGeometry args={[1.5, 1.6, 40]}/><meshBasicMaterial color="#52f1b6" side={THREE.DoubleSide}/></mesh>
    {scene !== 'runway' && Array.from({ length: scene === 'mountain' ? 10 : 7 }, (_, index) => <mesh key={index} position={[index % 2 ? -11 : 11, scene === 'mountain' ? 2 + index % 4 : 2 + index % 3, index * 7 - 22]}><boxGeometry args={[3.5, scene === 'mountain' ? 4 + index % 4 : 4 + index % 6, 3.5]}/><meshStandardMaterial color={scene === 'mountain' ? '#697660' : '#475f74'}/></mesh>)}
    <mesh position={[0, 0.06, -10]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.6,0.75,32]}/><meshBasicMaterial color="#ffab65" side={THREE.DoubleSide}/></mesh>
  </group>;
}
function Track({ points }: { points: FlightFrame[] }) {
  if (points.length < 2) return null;
  const stride = Math.max(1, Math.ceil(points.length / 450));
  const sampled = points.filter((_, index) => index % stride === 0).map((point) => new THREE.Vector3(point.x, point.y + 0.12, point.z));
  const positions = new Float32Array(sampled.flatMap((point) => [point.x,point.y,point.z]));
  return <line><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]}/></bufferGeometry><lineBasicMaterial color="#23dfff" linewidth={2}/></line>;
}
function Camera({ view, flight, cognition }: { view: View; flight?: SimulationSnapshot; cognition?: boolean }) {
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
    if (view === 'top' || cognition) camera.position.set(focus[0], focus[1] + (cognition ? 17.5 : 32), focus[2] + 0.01);
    else if (view === 'side') camera.position.set(focus[0] + 24, focus[1] + 8, focus[2]);
    else if (view === 'follow') camera.position.set(focus[0] + 9, focus[1] + 8, focus[2] + 13);
    else camera.position.set(cognition ? 3.3 : 11, cognition ? 2.8 : 10, cognition ? 5 : 15);
    camera.lookAt(...focus);
    if (controls && 'target' in controls) (controls as THREE.EventDispatcher & { target: THREE.Vector3 }).target.set(...focus);
  }, [view, cognition, camera, controls]);
  return null;
}
export function FlightCanvas({ flight, scene = 'runway', cognition = false, selectedPart, onPart, demonstration, trajectory = [], view = 'free', targetAltitude }: FlightCanvasProps) {
  return <Canvas shadows camera={{ position: cognition ? [5, 3.3, 5.5] : [11, 10, 15], fov: cognition ? 43 : 48 }} style={{ height: '100%', width: '100%', background: 'radial-gradient(#164163, #061a33)' }}>
    <color attach="background" args={['#061a33']}/><ambientLight intensity={1.7}/><directionalLight position={[9, 18, 8]} intensity={2.5} castShadow/><pointLight position={[-4, 4, -2]} intensity={2} color="#18b9ef"/>
    <Suspense fallback={null}>
      {!cognition && <Ground scene={scene ?? 'runway'}/>}
      <IrisDroneModel flight={flight} selectedPart={selectedPart} onPart={onPart} demonstration={demonstration} cognition={cognition}/>
      {!cognition && <Track points={trajectory}/>}
      {targetAltitude !== undefined && <group position={cognition ? [1.9, 0, 0] : [3.5, 0, -1]}>
        <mesh position={[0, cognition ? (0.5 + targetAltitude / 24) : targetAltitude / 2, 0]}><cylinderGeometry args={[0.015, 0.015, cognition ? (1 + targetAltitude / 12) : targetAltitude, 8]}/><meshBasicMaterial color="#6deee6"/></mesh>
        <mesh position={[0, cognition ? (1 + targetAltitude / 12) : targetAltitude, 0]}><sphereGeometry args={[0.14, 12, 12]}/><meshBasicMaterial color="#6deee6"/></mesh>
      </group>}
    </Suspense>
    <OrbitControls makeDefault enableDamping minDistance={cognition ? 8 : 5} maxDistance={cognition ? 40 : 95} maxPolarAngle={cognition ? Math.PI * 0.8 : Math.PI / 2.05}/>
    <Camera view={view} flight={flight} cognition={cognition}/>
  </Canvas>;
}
