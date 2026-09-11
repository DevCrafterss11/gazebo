export interface MissionWaypoint {
  sequence: number;
  latitude: number;
  longitude: number;
  altitudeMeters: number;
}

export interface Mission {
  id: string;
  name: string;
  waypoints: MissionWaypoint[];
  state: 'IDLE' | 'UPLOADED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
}

export interface MissionUpload {
  name: string;
  waypoints: MissionWaypoint[];
}
