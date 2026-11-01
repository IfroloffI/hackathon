"""LiveKit-агент расшифровки голосового чата Колизиума.

Попадание в комнаты:
  * LiveKit сам отправляет агента в каждую новую комнату (automatic dispatch) — в момент,
    когда первый игрок включает голос;
  * страховка: раз в SWEEP_SEC агент сверяет список комнат и через API досылает себя туда,
    где его нет (комнаты, открытые до старта/перезапуска агента, упавшие задачи).

В комнате агент невидим (hidden), подписывается на микрофоны игроков, режет речь на фразы
Silero VAD (пауза ≥ 0.6 с; сплошная речь — кусками по MAX_PHRASE_SEC), отправляет каждую
фразу (WAV 16 кГц) в whisper и складывает расшифровку в Redis.

Redis (вся история, без TTL):
  transcripts:room:<roomId>  LIST  JSON-записи по порядку окончания фраз (RPUSH)
  transcripts:rooms          ZSET  roomId → время последней фразы (мс)
  transcripts:live           PUB/SUB канал: каждая новая запись
roomId — id игровой комнаты Colyseus (имя LiveKit-комнаты без префикса «chronolet-»).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
import time
import uuid

import aiohttp
import redis.asyncio as aioredis
from livekit import api, rtc
from livekit.agents import (
    AgentServer,
    AutoSubscribe,
    JobContext,
    JobProcess,
    WorkerPermissions,
    cli,
    vad,
)
from livekit.plugins import silero

LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "ws://127.0.0.1:17880")
LIVEKIT_API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
LIVEKIT_API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "chronolet-dev-secret-please-change-01")
WHISPER_URL = os.environ.get("WHISPER_URL", "http://127.0.0.1:8770").rstrip("/")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ru")
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6380/0")
ROOM_PREFIX = os.environ.get("LIVEKIT_ROOM_PREFIX", "chronolet-")
# Фразы короче — обычно кашель/щелчки; Whisper на них галлюцинирует.
MIN_SPEECH_SEC = float(os.environ.get("MIN_SPEECH_SEC", "0.4"))
# Сплошную речь без пауз режем на куски такой длины, чтобы текст шёл порциями.
MAX_PHRASE_SEC = float(os.environ.get("MAX_PHRASE_SEC", "15"))
# Сколько звука держать до начала речи: VAD замечает её с задержкой, начало слова не теряем.
PREROLL_SEC = 1.0
SWEEP_SEC = float(os.environ.get("SWEEP_SEC", "15"))
SAMPLE_RATE = 16000

log = logging.getLogger("transcriber")


def room_id_of(livekit_room: str) -> str:
    return livekit_room[len(ROOM_PREFIX):] if livekit_room.startswith(ROOM_PREFIX) else livekit_room


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load(
        min_silence_duration=0.6,
        min_speech_duration=0.15,
        sample_rate=SAMPLE_RATE,
    )


server = AgentServer(
    setup_fnc=prewarm,
    # Комнат на хакатоне единицы: один прогретый процесс (по умолчанию 8 — лишняя память).
    num_idle_processes=int(os.environ.get("AGENT_IDLE_PROCESSES", "1")),
    # По умолчанию воркер перестаёт брать комнаты при загрузке CPU > 70% — а CPU грузит
    # соседний whisper. Без порога агент заходит в каждую комнату.
    load_threshold=float(os.environ.get("AGENT_LOAD_THRESHOLD", "inf")),
    # Невидим для игроков (не попадает в список участников) и сам ничего не публикует.
    permissions=WorkerPermissions(
        can_publish=False,
        can_subscribe=True,
        can_publish_data=False,
        hidden=True,
    ),
)


class RoomTranscriber:
    def __init__(self, ctx: JobContext, http: aiohttp.ClientSession, store: aioredis.Redis) -> None:
        self.ctx = ctx
        self.http = http
        self.store = store
        self.vad: vad.VAD = ctx.proc.userdata["vad"]
        self.room_name = ctx.room.name
        self.room_id = room_id_of(ctx.room.name)
        self.tasks: dict[str, asyncio.Task] = {}

    def on_track(self, track: rtc.Track, pub: rtc.RemoteTrackPublication, p: rtc.RemoteParticipant) -> None:
        if track.kind != rtc.TrackKind.KIND_AUDIO or pub.sid in self.tasks:
            return
        log.info("[%s] слушаю %s (%s)", self.room_id, p.name or p.identity, pub.sid)
        task = asyncio.create_task(self.listen(track, p))
        self.tasks[pub.sid] = task
        task.add_done_callback(lambda _: self.tasks.pop(pub.sid, None))

    def on_unsubscribed(self, _track: rtc.Track, pub: rtc.RemoteTrackPublication, _p: rtc.RemoteParticipant) -> None:
        task = self.tasks.get(pub.sid)
        if task is not None:
            task.cancel()

    async def listen(self, track: rtc.Track, p: rtc.RemoteParticipant) -> None:
        audio = rtc.AudioStream(track, sample_rate=SAMPLE_RATE, num_channels=1)
        stream = self.vad.stream()
        # Фразы одного игрока расшифровываем по очереди, чтобы порядок в истории не путался.
        phrases: asyncio.Queue[tuple[float, float, rtc.AudioFrame] | None] = asyncio.Queue()
        # Звук копим сами: VAD даёт только границы. Так длинную речь можно резать на ходу.
        buf: list[rtc.AudioFrame] = []
        state = {"sec": 0.0, "speaking": False, "last": time.time()}

        def flush(trailing_silence: float = 0.0) -> None:
            speech = state["sec"] - trailing_silence
            if speech >= MIN_SPEECH_SEC:
                ended = state["last"] - trailing_silence
                phrases.put_nowait((state["last"] - state["sec"], ended, rtc.combine_audio_frames(buf)))
            buf.clear()
            state["sec"] = 0.0

        async def pump() -> None:
            async for ev in audio:
                stream.push_frame(ev.frame)
                buf.append(ev.frame)
                state["sec"] += ev.frame.duration
                state["last"] = time.time()
                if not state["speaking"]:
                    while buf and state["sec"] - buf[0].duration >= PREROLL_SEC:
                        state["sec"] -= buf.pop(0).duration
            stream.end_input()

        async def cut() -> None:
            async for ev in stream:
                if ev.type == vad.VADEventType.START_OF_SPEECH:
                    state["speaking"] = True
                elif ev.type == vad.VADEventType.INFERENCE_DONE:
                    # Длинную речь режем в ближайшей микропаузе между словами, крайний срок — +5 с.
                    long_enough = state["sec"] >= MAX_PHRASE_SEC
                    if state["speaking"] and long_enough and (ev.probability < 0.2 or state["sec"] >= MAX_PHRASE_SEC + 5):
                        flush()
                elif ev.type == vad.VADEventType.END_OF_SPEECH:
                    state["speaking"] = False
                    if ev.speech_duration >= MIN_SPEECH_SEC:
                        flush(trailing_silence=min(ev.silence_duration, state["sec"]))
            phrases.put_nowait(None)

        async def transcribe() -> None:
            while (item := await phrases.get()) is not None:
                started, ended, frame = item
                try:
                    await self.handle_phrase(p, started, ended, frame)
                except Exception:
                    log.exception("[%s] не удалось расшифровать фразу %s", self.room_id, p.identity)

        try:
            await asyncio.gather(pump(), cut(), transcribe())
        finally:
            await stream.aclose()
            await audio.aclose()

    async def handle_phrase(self, p: rtc.RemoteParticipant, started: float, ended: float, frame: rtc.AudioFrame) -> None:
        form = aiohttp.FormData()
        form.add_field("file", frame.to_wav_bytes(), filename="phrase.wav", content_type="audio/wav")
        if WHISPER_LANGUAGE:
            form.add_field("language", WHISPER_LANGUAGE)
        t0 = time.monotonic()
        async with self.http.post(f"{WHISPER_URL}/v1/audio/transcriptions", data=form) as resp:
            resp.raise_for_status()
            result = await resp.json()
        text = (result.get("text") or "").strip()
        if not text:
            return
        entry = {
            "id": uuid.uuid4().hex,
            "roomId": self.room_id,
            "livekitRoom": self.room_name,
            "participantId": p.identity,
            "participantName": p.name or p.identity,
            "text": text,
            "language": result.get("language"),
            "startedAt": int(started * 1000),
            "endedAt": int(ended * 1000),
            "durationMs": int((ended - started) * 1000),
        }
        payload = json.dumps(entry, ensure_ascii=False)
        async with self.store.pipeline(transaction=True) as tx:
            tx.rpush(f"transcripts:room:{self.room_id}", payload)
            tx.zadd("transcripts:rooms", {self.room_id: entry["endedAt"]})
            tx.publish("transcripts:live", payload)
            await tx.execute()
        log.info("[%s] %s (%.1f с, whisper %.1f с): %s", self.room_id, entry["participantName"],
                 ended - started, time.monotonic() - t0, text)


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))
    store = aioredis.from_url(REDIS_URL, decode_responses=True)
    transcriber = RoomTranscriber(ctx, http, store)

    async def cleanup() -> None:
        for task in list(transcriber.tasks.values()):
            task.cancel()
        await http.close()
        await store.aclose()

    ctx.add_shutdown_callback(cleanup)
    ctx.room.on("track_subscribed", transcriber.on_track)
    ctx.room.on("track_unsubscribed", transcriber.on_unsubscribed)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    log.info("[%s] агент в комнате %s", transcriber.room_id, ctx.room.name)
    # Треки, на которые подписались до регистрации обработчиков.
    for p in ctx.room.remote_participants.values():
        for pub in p.track_publications.values():
            if pub.track is not None:
                transcriber.on_track(pub.track, pub, p)


async def sweep_forever() -> None:
    """Досылает агента в комнаты, где его нет (automatic dispatch срабатывает только при создании)."""
    lk = api.LiveKitAPI(LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://"),
                        LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
    recently: dict[str, float] = {}  # комната → когда досылали: даём агенту время зайти
    await asyncio.sleep(SWEEP_SEC)
    while True:
        try:
            rooms = (await lk.room.list_rooms(api.ListRoomsRequest())).rooms
            for r in rooms:
                if not r.name.startswith(ROOM_PREFIX) or time.time() - recently.get(r.name, 0) < 2 * SWEEP_SEC:
                    continue
                # Свежую комнату не трогаем: туда прямо сейчас заходит агент по automatic
                # dispatch, повторная отправка дала бы два агента и двойные записи.
                if time.time() - r.creation_time < SWEEP_SEC:
                    continue
                ps = (await lk.room.list_participants(api.ListParticipantsRequest(room=r.name))).participants
                if any(p.kind == api.ParticipantInfo.Kind.AGENT for p in ps):
                    continue
                if not any(p.kind != api.ParticipantInfo.Kind.AGENT for p in ps):
                    continue  # пустая комната — LiveKit скоро её закроет
                await lk.agent_dispatch.create_dispatch(api.CreateAgentDispatchRequest(room=r.name, agent_name=""))
                recently[r.name] = time.time()
                log.info("[%s] агента не было в комнате — досылаю", room_id_of(r.name))
        except Exception as e:  # LiveKit ещё не поднят / перезапускается — попробуем позже
            log.warning("проверка комнат не удалась: %s", e)
        await asyncio.sleep(SWEEP_SEC)


def start_sweeper() -> None:
    threading.Thread(target=lambda: asyncio.run(sweep_forever()), name="room-sweeper", daemon=True).start()


if __name__ == "__main__":
    # Только в главном процессе воркера: задачи комнат идут в отдельных процессах.
    start_sweeper()
    cli.run_app(server)
