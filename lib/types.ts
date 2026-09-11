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
}

export interface QueueCard {
  /** 같은 단어가 learn/quiz 로 두 번 나오므로 카드 고유 키가 따로 필요하다. */
  key: string;
  kind: CardKind;
  word: QueueWord;
  /** 취약 단어 표시용 */
  weak: boolean;
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
}

export interface PromptWeights {
  s2r: number;
  s2m: number;
  r2m: number;
}
