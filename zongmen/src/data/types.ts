// 数据文件的类型。数据本身在 data/ 和 config/ 里，经 tools/bundle-data.ts 打包成 bundle.gen.ts。

export type LocationId = 'library' | 'dorm' | 'alchemy' | 'kitchen' | 'training' | 'bamboo' | 'gate';
export type TraitId = string;
export type DiscipleId = string;

export interface NightSpot {
  location: LocationId;
  doing: string;
  detail: string;
}

export interface CharacterData {
  id: DiscipleId;
  name: string;
  /** 别人对他的其他称呼，用于编造检查 */
  aliases: string[];
  pronoun: '他' | '她';
  identity: string;
  personality: string;
  speech_style: string;
  catchphrases: string[];
  bio: string;
  traits: TraitId[];
  night_spots: NightSpot[];
  secret_id: string;
  look: { height: 'tall' | 'normal' | 'short'; hair: string; accent: string };
}

export interface TraitData {
  id: TraitId;
  category: 'robe' | 'habit' | 'item';
  name: string;
  visible: boolean;
  clue: string;
  hint: string;
}

export interface LocationData {
  id: LocationId;
  name: string;
  desc: string;
  empty_text: string;
  claimable: boolean;
}

export interface SecretData {
  id: string;
  owner: DiscipleId;
  location: LocationId;
  summary: string;
  /** 真相复盘里用的第三人称说明 */
  review: string;
  confession_points: string[];
  confession_quote: string;
  evidence: string;
  keywords: string[];
  /** 坦白前说出这些字眼就算泄露秘密（不含物证文字里就有的词） */
  leak_keywords: string[];
  fallback_confession: string;
}

export interface SlipData {
  text: string;
  keywords: string[];
  line: string;
}

export interface CaseTemplates {
  time_slots_all: string[];
  time_slots_crime: string[];
  stolen_items: Array<{ id: string; name: string; slips: SlipData[] }>;
  motives: Array<{ id: string; text: string }>;
  claim_stories: Partial<Record<LocationId, Array<{ doing: string; detail: string }>>>;
  testimony: Record<
    'claim' | 'presence' | 'presence_dorm' | 'exclusive_alone' | 'exclusive_with' | 'empty_room' | 'slip',
    string
  >;
  inaccessible: Partial<Record<LocationId, string>>;
  slip_clue: string;
  trait_clue: string;
  elder: { intro: string[]; dawn_warning: string; dawn: string; refused: string };
}

export interface VoiceLines {
  opener: string[];
  nervous: string[];
  deny: string[];
  confused: string[];
  friendly: string[];
  opinion: string[];
  chat: string[];
  manipulation: string[];
  unknown: string[];
  explained: string[];
}

export interface TemplateLines {
  tone_keywords: Record<'friendly' | 'pressing' | 'threatening' | 'manipulation', string[]>;
  intent_keywords: Record<'where' | 'saw' | 'secret' | 'opinion' | 'who', string[]>;
  voices: Record<DiscipleId, VoiceLines>;
  sleepy_notice: string;
}

export interface FallbackLines {
  evasive: Record<DiscipleId, string[]>;
  refuse: Record<DiscipleId, string>;
  blocked: string[];
  slip_template: string;
  epilogue: { success: string[]; fail: string[] };
}

export interface LeakPatterns {
  confession_patterns: string[];
  meta_words: string[];
}

export interface GameConfig {
  questions: number;
  dawn_warning_at: number;
  input_max_chars: number;
  history_turns: number;
  suspects_per_case: number;
  stress: {
    contradiction: number;
    irrelevant_evidence: number;
    tone: Record<PlayerTone, number>;
    confess_at: number;
    after_confess: number;
    culprit_panic_at: number;
    culprit_slip_at: number;
    refuse_at: number;
  };
  rating: { s_min_remaining: number };
  reply: { soft_max_chars: number; hard_max_chars: number };
  budget: {
    dialogue_calls: number;
    epilogue_calls: number;
    max_calls_per_case: number;
    max_input_tokens: number;
    max_card_tokens: number;
    max_output_tokens: number;
  };
  generator: {
    version: number;
    max_attempts: number;
    fact_min: number;
    fact_max: number;
    suspects_min: number;
    suspects_max: number;
  };
  model: {
    provider: 'template' | 'openai_compatible' | 'platform';
    providers: {
      openai_compatible: {
        base_url: string;
        model: string;
        api_key_env: string;
        /** 原样并进请求体的额外参数，如 DeepSeek 的 thinking 开关 */
        extra_body?: Record<string, unknown>;
        price_usd_per_million?: { input_miss: number; input_hit: number; output: number };
      };
      [k: string]: unknown;
    };
    dialogue: { temperature: number; max_tokens: number };
    epilogue: { temperature: number; max_tokens: number };
    json_mode: boolean;
    timeout_ms: number;
    retries: number;
  };
  dev: { show_call_stats: boolean };
}

export type Emotion = 'calm' | 'nervous' | 'angry' | 'scared' | 'sad' | 'relieved';
export type PlayerTone = 'friendly' | 'neutral' | 'pressing' | 'threatening' | 'off_topic' | 'manipulation';
export const EMOTIONS: readonly Emotion[] = ['calm', 'nervous', 'angry', 'scared', 'sad', 'relieved'];
export const PLAYER_TONES: readonly PlayerTone[] = [
  'friendly',
  'neutral',
  'pressing',
  'threatening',
  'off_topic',
  'manipulation',
];

export interface GameData {
  characters: CharacterData[];
  traits: TraitData[];
  locations: LocationData[];
  secrets: SecretData[];
  templates: CaseTemplates;
  templateLines: TemplateLines;
  fallback: FallbackLines;
  leak: LeakPatterns;
  blocklist: { words: string[] };
  prompts: { system_disciple: string; epilogue: string; turn: string; rules: string };
  config: GameConfig;
}
