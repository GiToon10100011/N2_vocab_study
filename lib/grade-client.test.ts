import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OUTBOX_KEY } from "./grade-outbox";
import type { GradeInput } from "./types";

const g = (n: number): GradeInput => ({
  wordId: `word-${String(n).padStart(8, "0")}`,
  kind: "s2r",
  correct: true,
  retry: false,
});

/** 탭을 닫았다 열어도 남는 저장소. 모듈을 새로 불러오는 것이 페이지를 새로 여는 것에 해당한다. */
const disk = new Map<string, string>();
const server = { ok: true, requests: 0 };

async function openPage() {
  vi.resetModules();
  return import("./grade-client");
}

const leftBehind = (...grades: GradeInput[]) =>
  disk.set(OUTBOX_KEY, JSON.stringify([{ id: "old", practice: false, grades }]));

beforeEach(() => {
  disk.clear();
  server.ok = true;
  server.requests = 0;
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    },
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", async () => {
    server.requests++;
    return { ok: server.ok, json: async () => ({ ok: server.ok }) };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("학습을 시작하기 전의 복구", () => {
  it("보낼 것이 없으면 시작을 막지 않고 큐도 새로 받지 않는다", async () => {
    const page = await openPage();
    // 개발 모드는 화면을 한 번 떼었다 다시 붙인다. 그때 보낼 것 없는 전송이 한 번 돈다.
    // 이것을 「보내는 중」으로 세면 학습 화면이 열릴 때마다 새로고침을 되풀이한다.
    const buffer = page.createUndoBuffer({ undoSeconds: 5, practice: false, onClose() {} });
    void buffer.close();

    expect(page.recoveryPending()).toBe(false);
    expect(await page.recoverBeforeSession()).toEqual({ reload: false, failed: 0 });
    expect(server.requests).toBe(0);
  });

  it("지난 세션이 남긴 채점을 보낸 뒤에는 큐를 새로 받게 한다", async () => {
    leftBehind(g(1), g(2));
    const page = await openPage();

    expect(page.recoveryPending()).toBe(true);
    expect(await page.recoverBeforeSession()).toEqual({ reload: true, failed: 0 });
    expect(disk.has(OUTBOX_KEY)).toBe(false);
  });

  it("먼저 돌던 전송이 보낸 것도 친다. 그 사이에 받은 큐는 반영 전의 것이다", async () => {
    leftBehind(g(1), g(2));
    const page = await openPage();
    const background = page.recoverInBackground(); // 홈에서 시작한 전송이 아직 돌고 있다

    expect(await page.recoverBeforeSession()).toEqual({ reload: true, failed: 0 });
    expect(await background).toBe(2);
    expect(server.requests).toBe(1); // 같은 채점을 두 번 보내지 않는다
  });

  it("전송에 실패하면 남겨 두고 실패한 수를 알린다", async () => {
    leftBehind(g(1), g(2));
    server.ok = false;
    const page = await openPage();

    expect(await page.recoverBeforeSession()).toEqual({ reload: false, failed: 2 });
    expect(page.unsentCount()).toBe(2);
  });
});

describe("받은 큐가 낡았는지", () => {
  it("학습 중에 나간 채점은 다음 학습 화면을 새로 받게 하지 않는다", async () => {
    const page = await openPage();
    const buffer = page.createUndoBuffer({ undoSeconds: 0, practice: false, onClose() {} });
    buffer.add(g(1));
    await buffer.close(); // 세션이 끝나 전송됐다. 다음 큐는 이 뒤에 만들어진다
    await page.releaseUndoBuffer(buffer);

    expect(server.requests).toBe(1);
    expect(page.recoveryPending()).toBe(false);
  });

  it("화면을 떠나면서 나간 채점이 있으면 다음 학습 화면은 큐를 새로 받는다", async () => {
    const page = await openPage();
    const buffer = page.createUndoBuffer({ undoSeconds: 0, practice: false, onClose() {} });
    buffer.add(g(1));
    await page.releaseUndoBuffer(buffer); // 뒤로 가기 등. 화면이 사라진 뒤에 서버에 닿는다

    expect(server.requests).toBe(1);
    expect(page.recoveryPending()).toBe(true);
    expect((await page.recoverBeforeSession()).reload).toBe(true);
  });
});
