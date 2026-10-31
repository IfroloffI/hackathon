import { matchMaker } from 'colyseus';
import { CREW_ROOM, type AuthPlayer, type ManagedRoomInfo } from '@chronolet/shared';

/**
 * REST-обёртка над Colyseus-комнатами. Комнаты живут в Colyseus (state,
 * реконнект, дисконнекты), а здесь — только управленческий слой:
 * кто мастер, публичная ли комната, когда создана.
 *
 * Хранилище — in-memory Map: после перезапуска сервера комнат нет,
 * как и самих Colyseus-комнат.
 */

interface ManagedRoom extends ManagedRoomInfo {
  /** Место мастера из matchMaker.create; не выдаётся наружу. */
  masterSessionId: string;
}

const rooms = new Map<string, ManagedRoom>();

/** Публичная ли комната: только созданные через RoomManager бывают приватными. */
export function isPublicRoom(roomId: string): boolean {
  return rooms.get(roomId)?.isPublic ?? true;
}

export function getManagedRoom(roomId: string): ManagedRoomInfo | null {
  return rooms.get(roomId) ?? null;
}

export async function createRoom(
  player: AuthPlayer,
  options: { crewName?: string; isPublic?: boolean },
): Promise<ManagedRoomInfo> {
  const isPublic = options.isPublic ?? false;
  const crewName = options.crewName?.trim() || undefined;

  const reservation = await matchMaker.create(CREW_ROOM, { name: player.name, crewName });
  const cache = await matchMaker.getRoomById(reservation.roomId);
  if (cache === undefined) {
    throw new Error(`комната ${reservation.roomId} исчезла сразу после создания`);
  }

  const info: ManagedRoom = {
    roomId: reservation.roomId,
    crewName: cache.metadata?.crewName ?? crewName ?? `Экипаж ${player.name}`,
    hostPlayerId: player.id,
    hostName: player.name,
    isPublic,
    clients: cache.clients,
    maxClients: cache.maxClients,
    createdAt: Date.now(),
    masterSessionId: reservation.sessionId,
  };
  rooms.set(info.roomId, info);
  return toPublicInfo(info);
}

/** Только мастер может удалить комнату. Возвращает false, если он не мастер. */
export function isHost(roomId: string, playerId: string): boolean {
  return rooms.get(roomId)?.hostPlayerId === playerId;
}

/**
 * Удаляет комнату: отключает всех участников (грейсфул — CrewRoom сам
 * сохранит позиции и закроет сессию в onDispose) и снимает с учёта.
 * Возвращает false, если комната не найдена.
 */
export async function deleteRoom(roomId: string): Promise<boolean> {
  if (!rooms.has(roomId)) { return false; }
  rooms.delete(roomId);
  await matchMaker.getLocalRoomById(roomId)?.disconnect();
  return true;
}

/** Снимает с учёта без дисконнекта (комната умерла сама). */
export function forgetRoom(roomId: string): void {
  rooms.delete(roomId);
}

export async function listRooms(): Promise<ManagedRoomInfo[]> {
  const live = await matchMaker.query({ name: CREW_ROOM });
  const liveById = new Map(live.map((cache) => [cache.roomId, cache]));

  for (const roomId of rooms.keys()) {
    if (!liveById.has(roomId)) { rooms.delete(roomId); }
  }

  return [...rooms.values()]
    .filter((room) => liveById.has(room.roomId))
    .map((room) => {
      const cache = liveById.get(room.roomId)!;
      room.clients = cache.clients;
      room.maxClients = cache.maxClients;
      return toPublicInfo(room);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

function toPublicInfo(room: ManagedRoom): ManagedRoomInfo {
  const { masterSessionId, ...info } = room;
  return info;
}
