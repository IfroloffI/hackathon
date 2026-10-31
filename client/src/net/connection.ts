import { Client, Callbacks, type Room } from '@colyseus/sdk';
import {
  CREW_ROOM,
  CrewState,
  SERVER_PORT,
  type CreateOptions,
  type JoinOptions,
  type PlayerState,
  type RoomListing,
} from '@chronolet/shared';

/**
 * Один хост: в prod клиент отдаётся тем же сервером (same origin),
 * в dev Vite живёт на :5173, а сервер — на :SERVER_PORT того же хоста.
 */
export const SERVER_URL = import.meta.env.DEV
  ? `${location.protocol}//${location.hostname}:${SERVER_PORT}`
  : location.origin;

const client = new Client(SERVER_URL);

export type NetPlayer = PlayerState;
export type CrewRoom = Room<any, CrewState>;

export const net = {
  async listRooms(): Promise<RoomListing[]> {
    const res = await fetch(`${SERVER_URL}/api/rooms`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async hostAddresses(): Promise<string[]> {
    const res = await fetch(`${SERVER_URL}/api/host`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { addresses: string[] }).addresses;
  },

  create(opts: CreateOptions): Promise<CrewRoom> {
    return client.create(CREW_ROOM, opts, CrewState);
  },

  joinByCode(code: string, opts: JoinOptions): Promise<CrewRoom> {
    return client.joinById(code.trim().toUpperCase(), opts, CrewState);
  },

  callbacks(room: CrewRoom) {
    return Callbacks.get(room);
  },
};
