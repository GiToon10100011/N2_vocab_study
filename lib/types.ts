/** 출제 유형. 이 3개가 전부다.
 *  뜻 -> 표기, 뜻 -> 읽기, 한자 쓰기 유형은 의도적으로 존재하지 않는다(기획 4.4). */
export type PromptType = "s2r" | "s2m" | "r2m";

/** 세션에 등장하는 카드 종류. 'learn' 은 문제가 아니라 신규 단어 첫 노출 카드다. */
export type CardKind = "learn" | PromptType;

export const PROMPT_TYPES: readonly PromptType[] = ["s2r", "s2m", "r2m"];

export const PROMPT_LABEL: Record<PromptType, string> = {
  s2r: "한자 → 읽기",
  s2m: "한자 → 뜻",
  r2m: "읽기 → 뜻",
};

export interface Word {
  id: string;
  surface: string;
  reading: string;
  meaning_ko: string;
  note: string | null;
  /** 이 단어가 속한 학습일 'YYYY-MM-DD'. 등록일과 분리되어 있어 소급 입력이 가능하다. */
  study_day: string;
  created_at: string;
  stage: number;
  /** 'YYYY-MM-DD' */
  next_review: string;
  last_reviewed: string | null;
  correct_count: number;
  wrong_count: number;
  streak: number;
  last_wrong_type: PromptType | null;
  suspended: boolean;
}

/** SRS 판정에 필요한 최소 필드. 순수 함수 테스트를 쉽게 하기 위해 따로 뽑았다. */
export type SrsState = Pick<
  Word,
  "stage" | "correct_count" | "wrong_count" | "streak" | "last_wrong_type"
>;

/** 세션 큐에 실어 보내는 단어 페이로드. */
export interface QueueWord {
  id: string;
  surface: string;
  reading: string;
  meaning_ko: string;
  stage: number;
  wrong_count: number;
}

/** 학습일 그룹. dayIndex 는 1부터 시작하는 "N일차". */
export interface StudyDayGroup {
  study_day: string;
  dayIndex: number;
  weekIndex: number;
  total: number;
  /** 이 그룹에서 오늘 SRS 주기상 복습이 걸린 개수 */
  dueToday: number;
  /** 이 그룹에서 아직 한 번도 학습하지 않은 개수 */
  newCount: number;
}

export interface QueueCard {
  /** 같은 단어가 learn/quiz 로 두 번 나오므로 카드 고유 키가 따로 필요하다. */
  key: string;
  kind: CardKind;
  word: QueueWord;
  /** 취약 단어 표시용 */
  weak: boolean;
  /** 실전 테스트에서 틀린 뒤 아직 두 번 연속 맞히지 못한 단어(「읽기 주의」). 없으면 키가 없다. */
  caution?: boolean;
}

export interface TodayCounts {
  newCount: number;
  reviewCount: number;
  weakCount: number;
  /** 등록된 전체 단어 수. 0 이면 "완료"가 아니라 "아직 없음"이다. */
  totalWords: number;
}

/** 클라이언트가 서버로 보내는 채점 1건. SRS 계산은 서버가 한다. */
export interface GradeInput {
  wordId: string;
  kind: CardKind;
  correct: boolean;
  /** 같은 세션 안에서의 재시도인가. true 면 SRS 를 건드리지 않고 로그만 남긴다. */
  retry: boolean;
  /** 실전 테스트에서 친 답(확정된 가나). 카드 채점에는 없다. 서버는 이것으로 다시 채점한다. */
  typed?: string;
  /** 실전 테스트에서 친 뜻. 읽기와 한 문항으로 함께 간다. 서버는 이것도 다시 채점한다. */
  typedMeaning?: string;
}

/** 실전 테스트의 한 문제. 읽기 · 뜻은 화면이 답을 받기 전까지 DOM 에 그리지 않는다. */
export interface TestQuestion {
  wordId: string;
  surface: string;
  reading: string;
  meaning_ko: string;
}

/** 이미 답한 문제. 이어서 푼 테스트의 끝 화면에 전체를 보여 주려고 서버가 함께 준다. */
export interface TestAnswered extends TestQuestion {
  /** 그때 친 확정 가나 */
  typed: string;
  /** 읽기를 맞혔는가 */
  correct: boolean;
  /** 그때 친 뜻. 뜻을 묻지 않던 때의 답이면 null */
  typedMeaning: string | null;
  /** 뜻 점수: 1 정답, 0.5 부분 정답, 0 오답. 뜻을 묻지 않던 때의 답이면 null */
  meaningCredit: number | null;
}

export interface PromptWeights {
  s2r: number;
  s2m: number;
  r2m: number;
}

export interface AppSettings {
  newLimit: number;
  reviewLimit: number;
  weights: PromptWeights;
  dayStartHour: number;
  /** 되돌리기 시간(초). 채점 뒤 손을 멈추고 이만큼 지나면 확정된다. 0 = 상시(세션이 끝날 때까지). */
  undoSeconds: number;
  /** 실전 테스트 한 번의 문제 수(10~100). 기본 40. */
  testSize: number;
  /** 마지막 자동 백업 시각(ISO). 백업이 멈춘 것을 앱에서 알아채기 위한 값. */
  lastBackupAt: string | null;
}
