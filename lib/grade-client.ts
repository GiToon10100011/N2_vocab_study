/**
 * 브라우저 쪽 연결부. lib/grade-outbox.ts 의 규칙에 실제 저장소(localStorage)와 전송(fetch)을 붙인다.
 * 되돌리기 창과 보관 규칙은 여기에 두지 않는다. 여기서 정하는 것은 전송을 한 줄로 세우는 것과,
 * 학습 화면이 받은 큐가 채점이 반영되기 전의 것인지뿐이다.
 */
import {
  UndoBuffer,
  deliverOutbox,
  readOutbox,
  type Delivery,
  type OutboxStorage,
  type SendGrades,
} from "./grade-outbox";

/** 응답이 이보다 늦으면 실패로 보고 남겨 둔다. 나가기 버튼이 끝없이 기다리지 않게 한다. */
const SEND_TIMEOUT_MS = 15_000;

/**
 * localStorage 를 쓸 수 없으면(차단, 용량 초과) 메모리에 둔다.
 * 그 경우 앱이 죽으면 지킬 수 없지만, 창이 닫힐 때 보내는 평소 동작은 그대로다.
 */
const memory = new Map<string, string>();
let memoryOnly = false;

const storage: OutboxStorage = {
  getItem(key) {
    if (!memoryOnly) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        memoryOnly = true;
      }
    }
    return memory.get(key) ?? null;
  },
  setItem(key, value) {
    if (!memoryOnly) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        memoryOnly = true;
        // 옛 값이 남아 있으면 다음에 들어올 때 이미 보낸 채점을 또 보낸다.
        try {
          window.localStorage.removeItem(key);
        } catch {
          /* 지울 수도 없으면 할 수 있는 것이 없다 */
        }
      }
    }
    memory.set(key, value);
  },
  removeItem(key) {
    if (!memoryOnly) {
      try {
        window.localStorage.removeItem(key);
        return;
      } catch {
        memoryOnly = true;
      }
    }
    memory.delete(key);
  },
};

const send: SendGrades = async (batch) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch("/api/grades", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ grades: batch.grades, practice: batch.practice }),
      signal: ctrl.signal,
    });
    if (!res.ok) return false;
    // 세션이 만료되면 로그인 화면으로 넘겨지는데 그 응답도 200 이다.
    // 서버가 받았다고 답한 경우만 보낸 것으로 친다.
    const data = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    return data?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

let chain: Promise<unknown> = Promise.resolve();
let inFlight = 0;
let deliveredTotal = 0;
/** 떠 있는 학습 화면 수. */
let sessions = 0;
/**
 * 학습 화면이 떠 있지 않은 동안 서버에 반영된 채점이 있다. 그 무렵에 받은 큐는 반영 전의 것일 수
 * 있다. 학습 중에 나간 채점은 치지 않는다. 다음 큐는 그 뒤에 만들어진다.
 */
let queueMayBeStale = false;

/** 한 번에 하나만 보낸다. 같은 묶음을 두 번 보내면 서버에 두 번 반영된다. */
function deliver(skipId?: () => string): Promise<Delivery> {
  // 보낼 것이 없으면 줄을 세우지 않는다. 빈 전송까지 「보내는 중」으로 세면 학습 화면이 그것을
  // 기다리고, 화면을 두 번 붙이는 개발 모드에서는 열 때마다 새로고침을 되풀이한다.
  const open = skipId?.();
  if (inFlight === 0 && !readOutbox(storage).some((b) => b.id !== open)) {
    return Promise.resolve({ delivered: 0, failed: 0 });
  }

  const run = async () => {
    const r = await deliverOutbox(storage, send, skipId?.());
    deliveredTotal += r.delivered;
    if (r.delivered > 0 && sessions === 0) queueMayBeStale = true;
    return r;
  };
  // 탭 사이에서도 겹치지 않게 잠근다. 잠금을 쥔 탭이 닫히면 저절로 풀린다.
  const locked = async (): Promise<Delivery> => {
    if (navigator.locks) {
      let started = false;
      try {
        return await navigator.locks.request("n2v-grades", () => {
          started = true;
          return run();
        });
      } catch (err) {
        // 잠금을 얻지 못한 경우에만 잠금 없이 보낸다. 보내다가 난 오류라면 다시 보내지 않는다.
        if (started) throw err;
      }
    }
    return run();
  };

  inFlight++;
  const p = chain.then(locked, locked).finally(() => {
    inFlight--;
  });
  chain = p.catch(() => undefined);
  return p;
}

export function createUndoBuffer(o: {
  undoSeconds: number;
  practice: boolean;
  onClose: () => void;
}): UndoBuffer {
  sessions++;
  return new UndoBuffer({ ...o, storage, deliver });
}

/** 학습 화면이 사라질 때 부른다. 남은 채점을 확정해 보낸다. */
export function releaseUndoBuffer(buffer: UndoBuffer): Promise<Delivery> {
  sessions--;
  return buffer.close();
}

/** 아직 서버에 가지 않은 채점 수. */
export function unsentCount(): number {
  return readOutbox(storage).reduce((n, b) => n + b.grades.length, 0);
}

/** 학습을 시작하기 전에 먼저 서버에 반영해야 할 채점이 있는가. */
export function recoveryPending(): boolean {
  return inFlight > 0 || queueMayBeStale || readOutbox(storage).length > 0;
}

/**
 * 남은 채점을 보낸다. reload 가 true 면 방금 받은 큐가 그 채점이 반영되기 전에 만들어졌을 수
 * 있다. 큐를 새로 받아야 한다.
 */
export async function recoverBeforeSession(): Promise<{ reload: boolean; failed: number }> {
  // 먼저 돌던 전송이 보낸 것도 친다. 돌고 있었다는 것만으로는 치지 않는다.
  const before = deliveredTotal;
  const r = await deliver();
  return { reload: queueMayBeStale || deliveredTotal > before, failed: r.failed };
}

/** 학습 화면 밖에서 부른다. 부른 뒤로 서버에 새로 반영된 채점 수를 돌려준다. */
export async function recoverInBackground(): Promise<number> {
  const before = deliveredTotal;
  await deliver();
  return deliveredTotal - before;
}
