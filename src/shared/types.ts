export interface CacheEntry {
  quickOverview: string | null
  deepDive: string | null
  tinderDesc: string | null
  generatedAt: number
  modelUsed: string | null
}

export type LlmAction = 'quick' | 'deep' | 'tinder' | 'search' | 'create'

export const LLM_ACTIONS: readonly LlmAction[] = [
  'quick',
  'deep',
  'tinder',
  'search',
  'create',
]

export type WarmKind = 'quick' | 'deep' | 'tinder'

export const WARM_KINDS: readonly WarmKind[] = ['quick', 'deep', 'tinder']

export interface Settings {
  connectionId: string | null
  testingMode: boolean
  perActionConnections: boolean
  connectionsByAction: Partial<Record<LlmAction, string | null>>
  warmOnImport: boolean
  warmOnImportKinds: WarmKind[]
  warmOnImportConcurrency: number
}

export type TinderMode = 'out' | 'chat'

export type TinderAction =
  | 'keep'
  | 'delete'
  | 'delete_mock'
  | 'accept'
  | 'decline'

export interface TinderHistoryEntry {
  id: string
  action: TinderAction
}

export interface TinderQueue {
  mode: TinderMode
  remainingIds: string[]
  history: TinderHistoryEntry[]
  kept: number
  deleted: number
  declined: number
  accepted: number
}

export interface CharacterSummary {
  id: string
  name: string
  description: string
  tags: string[]
  creator: string
  creator_notes: string
  image_id: string | null
  imageUrl: string | null
  personality?: string
  scenario?: string
  first_mes?: string
  mes_example?: string
  alternate_greetings?: string[]
}

/** A new character card Ari drafts before it lands in the library. */
export interface CharacterDraft {
  name: string
  description: string
  personality: string
  scenario: string
  first_mes: string
  mes_example: string
  creator_notes: string
  system_prompt: string
  post_history_instructions: string
  tags: string[]
  alternate_greetings: string[]
}

export interface CreateCardContext {
  sourceCharacterId: string | null
  sourceCharacterName: string
  chatMessageCount: number | null
  patternSummary: string
}

export interface CreateCardImages {
  avatar: string | null
  gallery: string[]
  greetings: string[]
}

export interface CreateCardResult {
  character: CharacterSummary
  images: CreateCardImages
}

export interface ConnectionInfo {
  id: string
  name: string
  provider: string
  model: string
  is_default: boolean
  has_api_key: boolean
}

export interface TinderProgress {
  current: number
  total: number
  kept: number
  deleted: number
  declined: number
  accepted: number
  remaining: number
}

export interface TinderCardView {
  character: CharacterSummary
  tinderDesc: string | null
  progress: TinderProgress
}

export const DEFAULT_SETTINGS: Settings = {
  connectionId: null,
  testingMode: false,
  perActionConnections: false,
  connectionsByAction: {},
  warmOnImport: false,
  warmOnImportKinds: ['quick', 'deep', 'tinder'],
  warmOnImportConcurrency: 2,
}

export const EMPTY_CACHE: CacheEntry = {
  quickOverview: null,
  deepDive: null,
  tinderDesc: null,
  generatedAt: 0,
  modelUsed: null,
}

export function emptyTinderQueue(mode: TinderMode): TinderQueue {
  return {
    mode,
    remainingIds: [],
    history: [],
    kept: 0,
    deleted: 0,
    declined: 0,
    accepted: 0,
  }
}
