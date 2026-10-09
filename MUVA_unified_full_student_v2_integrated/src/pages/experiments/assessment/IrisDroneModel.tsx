import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import type { SimulationSnapshot } from '../../../domain/assessment/model';
import { toThreeEuler } from '../../../services/assessment/coordinates';

interface Props {
  flight?: SimulationSnapshot;
  cognition?: boolean;
  selectedPart?: string;
  onPart?: (id: string) => void;
  demonstration?: 'roll' | 'pitch' | 'yaw' | 'throttle' | null;
  demonstrationPlaying?: boolean;
}

type Point = [number, number, number];

const motors: [number, number][] = [[-0.43, -0.43], [0.43, -0.43], [0.43, 0.43], [-0.43, 0.43]];
const highlightColor = '#ffd064';
const partMarkers: Record<string, { position: Point; radius: number }> = {
  frame: { position: [0, 0.18, 0], radius: 0.23 },
  controller: { position: [0, 0.22, 0], radius: 0.14 },
  gps: { position: [0, 0.43, -0.24], radius: 0.09 },
  imu: { position: [-0.11, 0.2, -0.08], radius: 0.09 },
  battery: { position: [0, -0.16, 0.035], radius: 0.16 },
  link: { position: [0.17, -0.12, 0.06], radius: 0.12 },
};
const bladeShape = new THREE.Shape();
bladeShape.moveTo(0, -0.016);
bladeShape.bezierCurveTo(0.08, -0.03, 0.22, -0.065, 0.27, -0.012);
bladeShape.bezierCurveTo(0.28, 0.024, 0.13, 0.042, 0, 0.016);
bladeShape.closePath();
const bladeGeometry = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.004, bevelSegments: 2 });

function Strut({ from, to, radius, color, highlighted = false }: { from: Point; to: Point; radius: number; color: string; highlighted?: boolean }) {
  const start = new THREE.Vector3(...from);
  const end = new THREE.Vector3(...to);
  const direction = end.clone().sub(start);
  return <mesh position={start.add(end).multiplyScalar(0.5)} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())}>
    <cylinderGeometry args={[radius, radius, direction.length(), 10]}/>
    <meshStandardMaterial color={highlighted ? highlightColor : color} emissive={highlighted ? '#ef8800' : '#000000'} emissiveIntensity={highlighted ? 0.8 : 0} metalness={0.45} roughness={0.4}/>
  </mesh>;
}

export function IrisDroneModel({ flight, cognition = false, selectedPart, onPart, demonstration, demonstrationPlaying = true }: Props) {
  const body = useRef<THREE.Group>(null);
  const attitude = useRef<THREE.Group>(null);
  const rotors = useRef<Array<THREE.Group | null>>([]);
  const phase = useRef(0);
  const [activeRotor, setActiveRotor] = useState(0);

  useFrame((_, delta) => {
    if (!demonstration) phase.current = 0;
    else if (demonstrationPlaying) phase.current += delta;
    const pulse = demonstration ? Math.sin(phase.current * 1.15) : 0;
    if (body.current && cognition) body.current.position.y = 1.5 + (demonstration === 'throttle' ? 0.25 * pulse : 0);
    if (attitude.current) {
      const [pitch, yaw, roll] = toThreeEuler(flight?.attitude ?? { pitch: 0, yaw: 0, roll: 0 });
      attitude.current.rotation.set(cognition && demonstration === 'pitch' ? 0.24 * pulse : pitch,
        cognition && demonstration === 'yaw' ? -0.5 * pulse : yaw,
        cognition && demonstration === 'roll' ? -0.3 * pulse : roll);
    }
    rotors.current.forEach((rotor, index) => {
      if (rotor) rotor.rotation.y += delta * (index % 2 ? 1 : -1) * (cognition ? demonstration && demonstrationPlaying ? 34 + (demonstration === 'throttle' ? 28 : index % 2 ? 12 : 0) : 0 : flight?.armed ? flight.airborne ? 55 : 20 : 0);
    });
  });

  const select = (id: string, rotorIndex?: number) => (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (rotorIndex !== undefined) setActiveRotor(rotorIndex);
    onPart?.(id);
  };
  const frameSelected = cognition && selectedPart === 'frame';
  const marker = selectedPart === 'motor' || selectedPart === 'propeller'
    ? { label: selectedPart === 'motor' ? '电机' : '螺旋桨', position: [motors[activeRotor]![0], 0.23, motors[activeRotor]![1]] as Point, radius: 0.12 }
    : selectedPart ? partMarkers[selectedPart] : undefined;

  return <group ref={body} position={cognition ? [0, 1.5, 0] : [flight?.position.x ?? 0, (flight?.position.y ?? 0) + 1.02, flight?.position.z ?? 0]}>
    <group ref={attitude} scale={cognition ? 6 : 2.6}>
      <group onClick={select('frame')}>
        <mesh position={[0, 0.03, 0]}><cylinderGeometry args={[0.225, 0.225, 0.038, 8]}/><meshStandardMaterial color={frameSelected ? highlightColor : '#202c35'} emissive={frameSelected ? '#ef8800' : '#000000'} emissiveIntensity={frameSelected ? 0.8 : 0} metalness={0.65} roughness={0.32}/></mesh>
        <mesh position={[0, 0.105, 0]}><cylinderGeometry args={[0.16, 0.18, 0.035, 8]}/><meshStandardMaterial color={frameSelected ? highlightColor : '#26323c'} emissive={frameSelected ? '#ef8800' : '#000000'} emissiveIntensity={frameSelected ? 0.8 : 0} metalness={0.58}/></mesh>
        {motors.map(([x, z], index) => <group key={index}>
          <Strut from={[x * 0.32, 0.025, z * 0.32]} to={[x, 0.035, z]} radius={0.033} color={index % 2 ? '#1471d9' : '#2269c8'} highlighted={frameSelected}/>
          <Strut from={[x * 0.32, -0.005, z * 0.32]} to={[x, -0.003, z]} radius={0.011} color="#101b28"/>
          <mesh position={[x * 0.69, 0.058, z * 0.69]} rotation={[0, -Math.atan2(z, x), 0]}>
            <boxGeometry args={[0.065, 0.02, 0.025]}/><meshStandardMaterial color={frameSelected ? highlightColor : '#4295ee'} emissive={frameSelected ? '#ef8800' : '#000000'} emissiveIntensity={frameSelected ? 0.8 : 0} metalness={0.45}/>
          </mesh>
        </group>)}
        {[-0.18, 0.18].map((side) => <group key={side}>
          <Strut from={[side, -0.035, -0.13]} to={[side * 1.27, -0.37, -0.25]} radius={0.017} color="#252d32"/>
          <Strut from={[side, -0.035, 0.13]} to={[side * 1.27, -0.37, 0.25]} radius={0.017} color="#252d32"/>
          <Strut from={[side * 1.27, -0.37, -0.29]} to={[side * 1.27, -0.37, 0.29]} radius={0.022} color="#20272d"/>
        </group>)}
        {[[-0.1, -0.12], [0.1, -0.12], [-0.1, 0.12], [0.1, 0.12]].map(([x, z], index) => <Strut key={index} from={[x!, -0.12, z!]} to={[x!, 0.09, z!]} radius={0.009} color="#707e84"/>)}
      </group>

      {motors.map(([x, z], index) => <group key={index} position={[x, 0.035, z]}>
        <group onClick={select('motor', index)}>
          <mesh><cylinderGeometry args={[0.075, 0.074, 0.055, 24]}/><meshStandardMaterial color={cognition && selectedPart === 'motor' ? highlightColor : '#1169bc'} emissive={cognition && selectedPart === 'motor' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'motor' ? 0.8 : 0} metalness={0.55}/></mesh>
          <mesh position={[0, 0.052, 0]}><cylinderGeometry args={[0.052, 0.06, 0.055, 24]}/><meshStandardMaterial color={cognition && selectedPart === 'motor' ? highlightColor : '#505a5d'} emissive={cognition && selectedPart === 'motor' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'motor' ? 0.8 : 0} metalness={0.82} roughness={0.25}/></mesh>
          <mesh position={[0, 0.083, 0]}><cylinderGeometry args={[0.043, 0.052, 0.009, 24]}/><meshStandardMaterial color="#a0abb0" metalness={0.8}/></mesh>
        </group>
        <group ref={(node) => { rotors.current[index] = node; }} position={[0, 0.097, 0]} rotation={[0, index * Math.PI / 4, 0]} onClick={select('propeller', index)}>
          {[0, Math.PI].map((angle) => <group key={angle} rotation={[0, angle, 0]}>
            <mesh geometry={bladeGeometry} rotation={[-Math.PI / 2, 0, 0]}>
              <meshStandardMaterial color={cognition && selectedPart === 'propeller' ? highlightColor : '#242d35'} emissive={cognition && selectedPart === 'propeller' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'propeller' ? 0.8 : 0} metalness={0.35} roughness={0.4} side={THREE.DoubleSide}/>
            </mesh>
          </group>)}
          <mesh><cylinderGeometry args={[0.024, 0.027, 0.025, 16]}/><meshStandardMaterial color="#141a1f" metalness={0.55}/></mesh>
        </group>
      </group>)}

      <group onClick={select('controller')} position={[0, 0.155, 0]}>
        <mesh><boxGeometry args={[0.23, 0.065, 0.19]}/><meshStandardMaterial color={cognition && selectedPart === 'controller' ? highlightColor : '#202a2e'} emissive={cognition && selectedPart === 'controller' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'controller' ? 0.8 : 0} metalness={0.45}/></mesh>
        <mesh position={[0, 0.038, 0]}><boxGeometry args={[0.19, 0.012, 0.15]}/><meshStandardMaterial color="#485359" metalness={0.6}/></mesh>
        {[[-0.082, -0.062], [0.082, -0.062], [-0.082, 0.062], [0.082, 0.062]].map(([x, z], index) => <mesh key={index} position={[x!, 0.048, z!]}><cylinderGeometry args={[0.011, 0.011, 0.009, 8]}/><meshStandardMaterial color="#bbc3be"/></mesh>)}
      </group>
      <group onClick={select('gps')} position={[0, 0, -0.24]}>
        <Strut from={[0, 0.09, 0]} to={[0, 0.36, 0]} radius={0.008} color="#434c51"/>
        <mesh position={[0, 0.37, 0]}><cylinderGeometry args={[0.052, 0.055, 0.027, 24]}/><meshStandardMaterial color={cognition && selectedPart === 'gps' ? highlightColor : '#c3c7c0'} emissive={cognition && selectedPart === 'gps' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'gps' ? 0.8 : 0} metalness={0.52}/></mesh>
        <mesh position={[0, 0.388, 0]}><cylinderGeometry args={[0.037, 0.044, 0.009, 24]}/><meshStandardMaterial color="#313a3c"/></mesh>
      </group>
      <group onClick={select('imu')} position={[-0.11, 0.115, -0.08]}>
        <mesh><boxGeometry args={[0.09, 0.021, 0.075]}/><meshStandardMaterial color={cognition && selectedPart === 'imu' ? highlightColor : '#197b82'} emissive={cognition && selectedPart === 'imu' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'imu' ? 0.8 : 0}/></mesh>
        <mesh position={[0, 0.015, 0]}><boxGeometry args={[0.045, 0.012, 0.04]}/><meshStandardMaterial color="#1b2d36"/></mesh>
      </group>
      <group onClick={select('battery')} position={[0, -0.16, 0.035]}>
        <mesh><boxGeometry args={[0.22, 0.23, 0.26]}/><meshStandardMaterial color={cognition && selectedPart === 'battery' ? highlightColor : '#244d86'} emissive={cognition && selectedPart === 'battery' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'battery' ? 0.8 : 0} roughness={0.55}/></mesh>
        <mesh position={[0, 0, 0.135]}><boxGeometry args={[0.16, 0.115, 0.005]}/><meshStandardMaterial color="#d6ded5"/></mesh>
        {[-0.082, 0.082].map((x) => <mesh key={x} position={[x, 0, 0]}><boxGeometry args={[0.015, 0.235, 0.27]}/><meshStandardMaterial color="#1d2021"/></mesh>)}
        <mesh position={[0.065, 0.14, 0.08]}><boxGeometry args={[0.07, 0.045, 0.06]}/><meshStandardMaterial color="#e2a54d"/></mesh>
        <Strut from={[0.065, 0.15, 0.08]} to={[0.14, 0.18, 0.12]} radius={0.009} color="#c34432"/>
      </group>
      <group onClick={select('link')} position={[0.17, -0.12, 0.06]}>
        <mesh><boxGeometry args={[0.1, 0.14, 0.16]}/><meshStandardMaterial color={cognition && selectedPart === 'link' ? highlightColor : '#3a4246'} emissive={cognition && selectedPart === 'link' ? '#ef8800' : '#000000'} emissiveIntensity={cognition && selectedPart === 'link' ? 0.8 : 0} metalness={0.3}/></mesh>
        <mesh position={[0.053, 0, 0]}><boxGeometry args={[0.006, 0.07, 0.11]}/><meshStandardMaterial color="#aeb7b7"/></mesh>
        <Strut from={[0.03, 0.07, 0]} to={[0.1, 0.22, 0.03]} radius={0.007} color="#757d80"/>
      </group>
      {cognition && marker && <group position={marker.position}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
          <ringGeometry args={[marker.radius, marker.radius + 0.014, 48]}/>
          <meshBasicMaterial color={highlightColor} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
        </mesh>
        <mesh raycast={() => {}}><sphereGeometry args={[0.022, 12, 12]}/><meshBasicMaterial color={highlightColor} depthTest={false} depthWrite={false}/></mesh>
      </group>}
    </group>
  </group>;
}
