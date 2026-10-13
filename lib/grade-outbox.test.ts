import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OUTBOX_KEY,
  UndoBuffer,
  deliverOutbox,
  normalizeUndoSeconds,
  readOutbox,
  type OutboxStorage,
  type SendGrades,
} from "./grade-outbox";
import type { GradeInput } from "./types";

type Sent = { practice: boolean; grades: GradeInput[] };

const g = (n: number, correct = true): GradeInput => ({
  wordId: `word-${String(n).padStart(8, "0")}`,
  kind: "s2r",
  correct,
  retry: false,
});

function memoryStorage(initial?: unknown): OutboxStorage {
  const m = new Map<string, string>();
  if (initial !== undefined) m.set(OUTBOX_KEY, JSON.stringify(initial));
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** 받은 것을 기록하는 가짜 서버. failing 을 켜면 전부 실패한다. */
function fakeServer() {
  const sent: Sent[] = [];
  const state = { failing: false };
  const send: SendGrades = async (batch) => {
    if (state.failing) return false;
    sent.push({ practice: batch.practice, grades: [...batch.grades] });
    return true;
  };
  return { sent, send, state };
}

function setup(undoSeconds: number, opts: { practice?: boolean; storage?: OutboxStorage } = {}) {
  const storage = opts.storage ?? memoryStorage();
  const server = fakeServer();
  const onClose = vi.fn();
  let n = 0;
  const buffer = new UndoBuffer({
    undoSeconds,
    practice: opts.practice ?? false,
    storage,
    deliver: (skipId) => deliverOutbox(storage, server.send, skipId()),
    onClose,
    newId: () => `s${++n}`,
  });
  return { buffer, storage, onClose, ...server };
}

const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("되돌리기 창", () => {
  it("창 안에서는 카드 수와 무관하게 되돌릴 수 있다", async () => {
    const { buffer, sent, storage } = setup(5);
    // 1초에 한 장씩 12장. 예전에는 5장째에 전송되면서 되돌리기가 끊겼다.
    for (let i = 1; i <= 12; i++) {
      buffer.add(g(i));
      await tick(1000);
    }
    expect(sent).toHaveLength(0);
    expect(buffer.size).toBe(12);

    for (let i = 0; i < 12; i++) expect(buffer.undo(), `${i + 1}번째 되돌리기`).toBe(true);
    expect(buffer.undo()).toBe(false);

    await tick(60_000);
    expect(sent).toHaveLength(0); // 전부 되돌렸으니 보낼 것이 없다
    expect(readOutbox(storage)).toEqual([]);
  });

  it("손을 멈추고 창이 지나면 전송되고 더는 되돌릴 수 없다", async () => {
    const { buffer, sent, onClose, storage } = setup(5);
    buffer.add(g(1));
    buffer.add(g(2, false));
    buffer.add(g(3));

    await tick(4999);
    expect(sent).toHaveLength(0);
    expect(onClose).not.toHaveBeenCalled();

    await tick(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ practice: false, grades: [g(1), g(2, false), g(3)] }]);
    expect(buffer.undo()).toBe(false);
    expect(readOutbox(storage)).toEqual([]); // 서버가 받은 뒤에야 지운다
  });

  it("채점할 때마다 창이 새로 열린다", async () => {
    const { buffer, sent } = setup(5);
    buffer.add(g(1));
    await tick(4000);
    buffer.add(g(2));
    await tick(4000);
    // 첫 채점은 8초 전이지만 손을 멈춘 지는 4초다. 둘 다 아직 되돌릴 수 있다.
    expect(sent).toHaveLength(0);
    expect(buffer.size).toBe(2);

    await tick(1000);
    expect(sent).toEqual([{ practice: false, grades: [g(1), g(2)] }]);
  });

  it("되돌리기도 손을 움직인 것으로 친다", async () => {
    const { buffer, sent } = setup(5);
    buffer.add(g(1));
    buffer.add(g(2));
    await tick(4000);
    expect(buffer.undo()).toBe(true);
    await tick(4000);
    expect(sent).toHaveLength(0);
    await tick(1000);
    expect(sent).toEqual([{ practice: false, grades: [g(1)] }]);
  });

  it("화면을 떠나 있는 사이 창이 지났으면 돌아왔을 때 보낸다", async () => {
    const { buffer, sent } = setup(5);
    buffer.add(g(1));
    // 백그라운드에서는 타이머가 멈춘다. 시계만 6초 흐른 상황.
    vi.setSystemTime(Date.now() + 6000);
    expect(sent).toHaveLength(0);

    buffer.sync();
    await tick(0);
    expect(sent).toEqual([{ practice: false, grades: [g(1)] }]);

    await tick(60_000); // 뒤늦게 깨어난 타이머가 또 보내지 않는다
    expect(sent).toHaveLength(1);
  });

  it("연습 세션의 채점은 연습으로 표시되어 나간다", async () => {
    const { buffer, sent } = setup(5, { practice: true });
    buffer.add(g(1, false));
    await tick(5000);
    expect(sent).toEqual([{ practice: true, grades: [g(1, false)] }]);
  });
});

describe("상시 (0)", () => {
  it("세션이 끝날 때까지 보내지 않고 계속 되돌릴 수 있다", async () => {
    const { buffer, sent, onClose, storage } = setup(0);
    buffer.add(g(1));
    buffer.add(g(2));
    buffer.add(g(3));

    await tick(3_600_000);
    expect(sent).toHaveLength(0);
    expect(buffer.undo()).toBe(true); // 한 시간 뒤에도
    buffer.add(g(4));

    await buffer.close(); // 세션 종료
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ practice: false, grades: [g(1), g(2), g(4)] }]);
    expect(readOutbox(storage)).toEqual([]);
  });
});

describe("백업과 복구", () => {
  it("채점은 보내기 전부터 저장소에 있다", () => {
    const { buffer, storage } = setup(5);
    buffer.add(g(1));
    buffer.add(g(2));
    expect(readOutbox(storage)).toEqual([{ id: "s1", practice: false, grades: [g(1), g(2)] }]);

    buffer.undo();
    expect(readOutbox(storage)).toEqual([{ id: "s1", practice: false, grades: [g(1)] }]);
  });

  it("앱이 죽어 남은 채점을 다음 진입 때 보낸다", async () => {
    const crashed = setup(0);
    crashed.buffer.add(g(1));
    crashed.buffer.add(g(2, false));
    crashed.buffer.add(g(3));
    // close 를 부르지 못하고 끝났다. 서버는 아무것도 받지 못했다.
    expect(crashed.sent).toHaveLength(0);

    const next = fakeServer();
    expect(await deliverOutbox(crashed.storage, next.send)).toEqual({ delivered: 3, failed: 0 });
    expect(next.sent).toEqual([{ practice: false, grades: [g(1), g(2, false), g(3)] }]);
    expect(readOutbox(crashed.storage)).toEqual([]);
  });

  it("예전 형식의 실패분도 보내고, 연습과 실제 복습을 섞지 않는다", async () => {
    // 이전 버전은 id 없이 { practice, grades } 만 남겼다.
    const storage = memoryStorage([
      { practice: false, grades: [g(1)] },
      { practice: true, grades: [g(2), g(3, false)] },
    ]);
    const { sent, send } = fakeServer();
    expect(await deliverOutbox(storage, send)).toEqual({ delivered: 3, failed: 0 });
    expect(sent).toEqual([
      { practice: false, grades: [g(1)] },
      { practice: true, grades: [g(2), g(3, false)] },
    ]);
    expect(readOutbox(storage)).toEqual([]);
  });

  it("전송에 실패하면 남겨 두었다가 다음에 다시 보낸다", async () => {
    const { buffer, sent, state, storage } = setup(5);
    buffer.add(g(1));
    buffer.add(g(2));
    state.failing = true;
    await tick(5000);
    expect(sent).toHaveLength(0);
    expect(readOutbox(storage).flatMap((b) => b.grades)).toEqual([g(1), g(2)]);
    expect(buffer.undo()).toBe(false); // 창은 닫혔다. 못 보냈다고 되돌릴 수 있게 되지는 않는다

    state.failing = false;
    buffer.add(g(3));
    expect(await buffer.close()).toEqual({ delivered: 3, failed: 0 });
    expect(sent.flatMap((b) => b.grades)).toEqual([g(1), g(2), g(3)]);
    expect(readOutbox(storage)).toEqual([]);
  });

  it("응답을 받지 못해 다시 보낼 때 묶음 id 와 내용이 그대로다", async () => {
    // 서버는 id 와 내용이 같은 요청을 한 번만 반영한다. 다시 보내는 쪽이 둘 중 하나라도 바꾸면
    // 서버는 새 요청으로 보고 한 번 더 반영한다.
    const storage = memoryStorage([{ id: "b1", practice: false, grades: [g(1), g(2)] }]);
    const received: { id: string; practice: boolean; grades: GradeInput[] }[] = [];
    let answered = false;
    const send: SendGrades = async (batch) => {
      received.push({ ...batch, grades: [...batch.grades] });
      return answered; // 처음에는 서버가 받았지만 응답이 닿지 않았다
    };

    expect(await deliverOutbox(storage, send)).toEqual({ delivered: 0, failed: 2 });
    answered = true;
    expect(await deliverOutbox(storage, send)).toEqual({ delivered: 2, failed: 0 });

    expect(received).toHaveLength(2);
    expect(received[1]).toEqual(received[0]);
    expect(received[0].id).toBe("b1");
    expect(readOutbox(storage)).toEqual([]);
  });

  it("창이 닫힐 때마다 다른 묶음 id 로 나간다", async () => {
    const ids: string[] = [];
    const storage = memoryStorage();
    let n = 0;
    const buffer = new UndoBuffer({
      undoSeconds: 0,
      practice: false,
      storage,
      deliver: (skipId) =>
        deliverOutbox(
          storage,
          async (batch) => {
            ids.push(batch.id);
            return true;
          },
          skipId(),
        ),
      onClose() {},
      newId: () => `s${++n}`,
    });

    buffer.add(g(1));
    await buffer.close();
    buffer.add(g(2));
    await buffer.close();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("200건씩 끊어 보내고 서버가 받은 만큼만 지운다", async () => {
    const all = Array.from({ length: 450 }, (_, i) => g(i));
    const storage = memoryStorage([{ id: "big", practice: false, grades: all }]);
    const sizes: number[] = [];
    let calls = 0;
    const flaky: SendGrades = async (batch) => {
      if (++calls === 2) return false; // 두 번째 요청에서 끊긴다
      sizes.push(batch.grades.length);
      return true;
    };

    expect(await deliverOutbox(storage, flaky)).toEqual({ delivered: 200, failed: 250 });
    expect(readOutbox(storage)).toEqual([{ id: "big", practice: false, grades: all.slice(200) }]);

    expect(await deliverOutbox(storage, flaky)).toEqual({ delivered: 250, failed: 0 });
    expect(sizes).toEqual([200, 200, 50]);
    expect(readOutbox(storage)).toEqual([]);
  });

  it("아직 되돌릴 수 있는 열린 묶음은 건너뛴다", async () => {
    const storage = memoryStorage([
      { id: "old", practice: false, grades: [g(1)] },
      { id: "open", practice: false, grades: [g(2)] },
    ]);
    const { sent, send } = fakeServer();
    expect(await deliverOutbox(storage, send, "open")).toEqual({ delivered: 1, failed: 0 });
    expect(sent).toEqual([{ practice: false, grades: [g(1)] }]);
    expect(readOutbox(storage)).toEqual([{ id: "open", practice: false, grades: [g(2)] }]);
  });

  it("다른 탭이 가져가 보낸 채점은 다시 보내지 않는다", async () => {
    const { buffer, sent, onClose, storage } = setup(0);
    buffer.add(g(1));
    buffer.add(g(2));

    // 다른 탭이 앱을 열면서 저장소에 있는 것을 전부 보냈다.
    const other = fakeServer();
    await deliverOutbox(storage, other.send);
    expect(other.sent.flatMap((b) => b.grades)).toEqual([g(1), g(2)]);

    buffer.sync(); // storage 이벤트
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(buffer.undo()).toBe(false); // 이미 서버에 있다. 되돌릴 수 없다

    buffer.add(g(3));
    await buffer.close();
    expect(sent).toEqual([{ practice: false, grades: [g(3)] }]);
  });

  it("깨진 저장소 값은 빈 것으로 본다", () => {
    for (const raw of ["not json", "{}", "null", '[{"practice":false}]', '[{"grades":[]}]']) {
      const storage = memoryStorage();
      storage.setItem(OUTBOX_KEY, raw);
      expect(readOutbox(storage), raw).toEqual([]);
    }
  });
});

describe("normalizeUndoSeconds", () => {
  it("0~300 의 정수로 맞춘다", () => {
    expect(normalizeUndoSeconds(5)).toBe(5);
    expect(normalizeUndoSeconds(0)).toBe(0); // 상시
    expect(normalizeUndoSeconds(300)).toBe(300);
    expect(normalizeUndoSeconds(301)).toBe(300);
    expect(normalizeUndoSeconds(-3)).toBe(0);
    expect(normalizeUndoSeconds(12.6)).toBe(13);
  });

  it("숫자가 아니면 상시가 아니라 기본값 5 로 둔다", () => {
    // 빈 입력이 0 으로 읽혀 조용히 상시가 되면 안 된다.
    for (const v of [NaN, undefined, null, "", "30", Infinity]) {
      expect(normalizeUndoSeconds(v), String(v)).toBe(5);
    }
  });
});
