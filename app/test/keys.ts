/**
 * 제출 · 다음으로 칠 Enter 인가. IME 조합을 확정하는 Enter 는 아니다.
 *
 * Safari 는 조합을 확정하는 Enter 를 compositionend 뒤에 보내서 isComposing 으로는 걸러지지 않는다.
 * 그 키는 keyCode 가 229 다. 이걸 놓치면 아이폰에서 가나를 확정할 때마다 답이 제출된다.
 * 꾹 눌러 반복되는 Enter(repeat)도 제외한다 — 제출 직후 정답 대조를 보지 못하고 다음 문제로 넘어가 버린다.
 * IME 조합 내용을 가로채거나 고치지 않는다(절대 규칙 6).
 */
export function isSubmitKey(
  e: { key: string; isComposing: boolean; keyCode: number; repeat: boolean },
  composing: boolean,
): boolean {
  return e.key === "Enter" && !e.isComposing && !composing && e.keyCode !== 229 && !e.repeat;
}
