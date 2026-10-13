/**
 * 아직 서버에 가지 않은 채점을 다루는 곳. 두 가지를 한다.
 *
 *   1. 되돌리기 창 — 채점한 뒤 손을 멈추고 N초가 지나기 전에는 몇 장이든 되돌릴 수 있다.
 *      창이 닫히면 그때까지의 채점이 확정되어 서버로 간다. N = 0 은 상시: 세션이 끝날 때 닫힌다.
 *   2. 백업 — 채점은 하는 즉시 저장소에 적고, 서버가 받았다고 답한 뒤에야 지운다.
 *      앱이 도중에 죽어도 다음에 들어올 때 남은 것을 보낸다.
 *
 * 서버에서 채점을 취소하지는 않는다. SRS 상태를 거꾸로 돌리는 대신 보내는 것을 미룬다.
 * 브라우저 API 를 직접 쓰지 않는다. 저장소와 전송을 받아서 쓰므로 그대로 테스트한다.
 */
import type { GradeInput } from "./types";

/** 되돌리기 시간(초)의 기본값. 이 설정이 생기기 전의 동작(5초)과 같다. */
export const DEFAULT_UNDO_SECONDS = 5;
export const MAX_UNDO_SECONDS = 300;

/** 0 = 상시. 숫자가 아닌 값은 0 이 아니라 기본값으로 둔다 — 빈 입력이 조용히 상시가 되면 안 된다. */
export function normalizeUndoSeconds(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_UNDO_SECONDS;
  return Math.max(0, Math.min(MAX_UNDO_SECONDS, Math.round(v)));
}

/* ------------------------------------------------------------------ *
 * 보낼 채점 묶음 보관
 * ------------------------------------------------------------------ */

export const OUTBOX_KEY = "n2v_pending_grades";

/** 서버는 한 요청에 500건까지만 읽는다(MAX_BATCH). 넘치는 분이 잘려 나가지 않게 끊어 보낸다. */
const CHUNK = 200;

/** 연습 여부가 묶음마다 다를 수 있으므로 묶음 단위로 보관한다. 연습과 실제 복습은 섞이지 않는다. */
export interface OutboxBatch {
  id: string;
  practice: boolean;
  grades: GradeInput[];
}

export type OutboxStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * 서버가 받았다고 답했을 때만 true.
 *
 * id 는 묶음 id 다. 서버가 반영했는데 응답이 닿지 않으면 같은 묶음을 다시 보내게 되는데, 서버는
 * id 와 내용이 같은 요청을 한 번만 반영한다. 그래서 다시 보낼 때는 id 도 내용도 그대로여야 한다.
 */
export type SendGrades = (batch: {
  id: string;
  practice: boolean;
  grades: GradeInput[];
}) => Promise<boolean>;

/** 채점 건수 기준. */
export interface Delivery {
  delivered: number;
  failed: number;
}

export function readOutbox(storage: OutboxStorage): OutboxBatch[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(OUTBOX_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: OutboxBatch[] = [];
  parsed.forEach((b: Partial<OutboxBatch> | null, i) => {
    if (!b || !Array.isArray(b.grades) || b.grades.length === 0) return;
    // 이전 버전이 남긴 전송 실패분에는 id 가 없다. 자리 순서로 이름을 붙여 같이 다룬다.
    out.push({
      id: typeof b.id === "string" ? b.id : `legacy:${i}`,
      practice: b.practice === true,
      grades: b.grades,
    });
  });
  return out;
}

function writeOutbox(storage: OutboxStorage, batches: OutboxBatch[]): void {
  if (batches.length === 0) storage.removeItem(OUTBOX_KEY);
  else storage.setItem(OUTBOX_KEY, JSON.stringify(batches));
}

/** 묶음 하나를 넣거나 갈아 끼운다. 채점이 비면 지운다. */
export function putBatch(storage: OutboxStorage, batch: OutboxBatch): void {
  const all = readOutbox(storage);
  const at = all.findIndex((b) => b.id === batch.id);
  if (at >= 0) all[at] = batch;
  else all.push(batch);
  writeOutbox(
    storage,
    all.filter((b) => b.grades.length > 0),
  );
}

const same = (a: GradeInput, b: GradeInput) =>
  a.wordId === b.wordId && a.kind === b.kind && a.correct === b.correct && a.retry === b.retry;

/**
 * 저장소에 있는 묶음을 보낸다. skipId 는 아직 되돌릴 수 있는 열린 묶음이라 건드리지 않는다.
 * 요청마다 저장소를 다시 읽는다 — 보내는 사이 다른 탭이 먼저 보냈거나 고쳤을 수 있다.
 */
export async function deliverOutbox(
  storage: OutboxStorage,
  send: SendGrades,
  skipId?: string,
): Promise<Delivery> {
  const result: Delivery = { delivered: 0, failed: 0 };
  const todo = readOutbox(storage);
  writeOutbox(storage, todo); // 예전 형식에 붙인 id 를 굳힌다

  for (const { id } of todo) {
    if (id === skipId) continue;
    for (;;) {
      const batch = readOutbox(storage).find((b) => b.id === id);
      if (!batch) break;
      const chunk = batch.grades.slice(0, CHUNK);
      if (!(await send({ id, practice: batch.practice, grades: chunk }))) {
        result.failed += batch.grades.length;
        break;
      }
      result.delivered += chunk.length;

      // 서버가 받은 만큼만 지운다. 그 사이 묶음이 바뀌었으면 보낸 것과 같은 앞부분까지만.
      const now = readOutbox(storage).find((b) => b.id === id);
      if (!now) break;
      let sent = 0;
      while (sent < chunk.length && sent < now.grades.length && same(now.grades[sent], chunk[sent])) {
        sent++;
      }
      putBatch(storage, { ...now, grades: now.grades.slice(sent) });
      if (sent === 0) break;
    }
  }
  return result;
}

/* ------------------------------------------------------------------ *
 * 되돌리기 창
 * ------------------------------------------------------------------ */

export interface UndoBufferOptions {
  /** 되돌리기 시간(초). 0 = 상시 */
  undoSeconds: number;
  practice: boolean;
  storage: OutboxStorage;
  /**
   * 저장소에 있는 것을 보낸다. skipId 는 실행이 시작될 때 불러야 한다 — 전송이 줄을 서 있는
   * 사이에 새 채점이 쌓였을 수 있고, 그것까지 보내면 되돌리기 창을 어기게 된다.
   */
  deliver: (skipId: () => string) => Promise<Delivery>;
  /** 창이 닫혔다. 그 앞의 채점은 더 이상 되돌릴 수 없다. */
  onClose: () => void;
  newId?: () => string;
}

export class UndoBuffer {
  /** 아직 되돌릴 수 있는 채점. 저장소의 열린 묶음과 같은 내용이다. */
  private pending: GradeInput[] = [];
  private openId: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline = Infinity;
  private readonly newId: () => string;

  constructor(private readonly o: UndoBufferOptions) {
    this.newId =
      o.newId ?? (() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    this.openId = this.newId();
  }

  /** 지금 되돌릴 수 있는 채점 수 */
  get size(): number {
    return this.pending.length;
  }

  add(grade: GradeInput): void {
    this.sync();
    this.pending.push(grade);
    this.mirror();
    this.arm();
  }

  /** 마지막 채점을 없던 일로 한다. 창이 이미 닫혔으면 false. */
  undo(): boolean {
    this.sync();
    if (this.pending.length === 0) return false;
    this.pending.pop();
    this.mirror();
    this.arm();
    return true;
  }

  /** 창을 닫고 보낸다. 손을 멈춘 지 N초가 지났을 때, 세션이 끝날 때, 세션을 나갈 때 부른다. */
  close(): Promise<Delivery> {
    this.disarm();
    if (this.pending.length > 0) {
      // 저장소의 묶음은 그대로 두고 이름만 내려놓는다. 이후의 채점은 새 묶음에 쌓인다.
      this.pending = [];
      this.openId = this.newId();
      this.o.onClose();
    }
    return this.o.deliver(() => this.openId);
  }

  /**
   * 저장소와 시계에 맞춘다. 다른 탭이 저장소를 바꿨을 때와 화면으로 돌아왔을 때 부른다.
   * 저장소가 기준이다. 열린 묶음이 줄어 있으면 다른 탭이 가져가 보낸 것이고 이미 서버에 있다.
   */
  sync(): void {
    if (this.pending.length === 0) return;
    const mine = readOutbox(this.o.storage).find((b) => b.id === this.openId);
    const kept = mine?.grades.length ?? 0;
    if (kept < this.pending.length) {
      this.pending = kept > 0 ? this.pending.slice(-kept) : [];
      if (kept === 0) this.disarm();
      this.o.onClose();
    } else if (Date.now() >= this.deadline) {
      // 백그라운드에서는 타이머가 멈춘다. 떠나 있는 사이 창이 지났으면 지금 닫는다.
      void this.close().catch(() => undefined);
    }
  }

  dispose(): void {
    this.disarm();
  }

  private mirror(): void {
    putBatch(this.o.storage, {
      id: this.openId,
      practice: this.o.practice,
      grades: this.pending,
    });
  }

  private arm(): void {
    this.disarm();
    if (this.o.undoSeconds <= 0 || this.pending.length === 0) return;
    const ms = this.o.undoSeconds * 1000;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => void this.close().catch(() => undefined), ms);
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.deadline = Infinity;
  }
}
