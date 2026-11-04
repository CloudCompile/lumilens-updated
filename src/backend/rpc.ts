import {
  isFrontendMessage,
  type BackendToFrontend,
  type FrontendToBackend,
  type RequestOf,
  type RequestType,
  type ResultBody,
} from '../shared/protocol'
import type { ConnectionInfo, TinderMode } from '../shared/types'
import { getAriAvatarDataUrl } from './ari-avatar'
import { clearCachedKind, getOrEmpty } from './cache'
import {
  getCharacter,
  resolveCharacter,
  toSummary,
} from './characters'
import {
  GenerateError,
  generateDeepDive,
  generateQuickOverview,
  generateTinderDesc,
} from './generate'
import { noteUserContext } from './import-warm'
import { findCards, surpriseCharacter } from './picker'
import { createCardFromDraft, draftCard, generateCharacterImages, surpriseCards } from './create-card'
import { getSettings, setSettings } from './settings'
import {
  getActiveTinderMode,
  initTinder,
  reshuffleTinder,
  setActiveTinderMode,
  swipeTinder,
  undoTinder,
} from './tinder'
import {
  cancelWarmLibrary,
  estimateWarmLibrary,
  normalizeWarmKinds,
  startWarmLibrary,
} from './warm-library'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

type Handler<K extends RequestType> = (
  msg: RequestOf<K>,
  uid: string | undefined,
) => Promise<ResultBody<K>> | ResultBody<K>

type AnyHandler = (
  msg: FrontendToBackend,
  uid: string | undefined,
) => Promise<{ type: string }> | { type: string }

const handlers: { [K in RequestType]: Handler<K> } = {
  get_settings: async () => ({
    type: 'get_settings_result',
    settings: await getSettings(),
  }),
  set_settings: async (msg) => ({
    type: 'set_settings_result',
    settings: await setSettings(msg.settings),
  }),
  list_connections: async (_msg, uid) => {
    const list = await spindle.connections.list(uid)
    const connections: ConnectionInfo[] = (list || []).map((c) => ({
      id: c.id,
      name: c.name,
      provider: c.provider,
      model: c.model,
      is_default: !!c.is_default,
      has_api_key: !!c.has_api_key,
    }))
    return { type: 'list_connections_result', connections }
  },
  get_ari_avatar: async () => ({
    type: 'get_ari_avatar_result',
    dataUrl: await getAriAvatarDataUrl(),
  }),
  get_quick_view: async (msg, uid) => {
    const char = await getCharacter(msg.characterId, uid)
    if (!char) throw new RpcError('That character is gone.', 'not_found')
    const [character, cache] = await Promise.all([
      toSummary(char, true, uid),
      getOrEmpty(msg.characterId),
    ])
    return {
      type: 'get_quick_view_result',
      character,
      quickOverview: cache.quickOverview,
      deepDive: cache.deepDive,
    }
  },
  generate_quick_overview: async (msg, uid) => ({
    type: 'generate_quick_overview_result',
    ...(await generateQuickOverview(msg.characterId, msg.force === true, uid)),
  }),
  generate_deep_dive: async (msg, uid) => ({
    type: 'generate_deep_dive_result',
    ...(await generateDeepDive(msg.characterId, msg.force === true, uid)),
  }),
  generate_tinder_desc: async (msg, uid) => ({
    type: 'generate_tinder_desc_result',
    ...(await generateTinderDesc(msg.characterId, msg.force === true, uid)),
  }),
  picker_surprise: async (_msg, uid) => ({
    type: 'picker_surprise_result',
    character: await surpriseCharacter(uid),
  }),
  picker_find: async (msg, uid) => ({
    type: 'picker_find_result',
    ...(await findCards({
      tags: msg.tags || [],
      query: msg.query || '',
      excludeIds: msg.excludeIds,
      userId: uid,
    })),
  }),
  tinder_init: async (msg, uid) => {
    setActiveTinderMode(msg.mode)
    const { card, empty } = await initTinder(msg.mode, uid)
    return { type: 'tinder_init_result', card, empty }
  },
  tinder_swipe: async (msg, uid) => ({
    type: 'tinder_swipe_result',
    ...(await swipeTinder(getActiveTinderMode(), msg.direction, uid)),
  }),
  tinder_undo: async (_msg, uid) => ({
    type: 'tinder_undo_result',
    ...(await undoTinder(getActiveTinderMode(), uid)),
  }),
  tinder_reshuffle: async (_msg, uid) => ({
    type: 'tinder_reshuffle_result',
    ...(await reshuffleTinder(getActiveTinderMode(), uid)),
  }),
  clear_cache_kind: async (msg, uid) => {
    const kind = normalizeWarmKinds([msg.kind])[0]
    if (!kind) throw new RpcError('Pick quick, deep, or tinder.')
    const cleared = await clearCachedKind(kind, uid)
    return { type: 'clear_cache_kind_result', kind, cleared }
  },
  warm_library_estimate: async (msg, uid) => {
    const estimate = await estimateWarmLibrary(normalizeWarmKinds(msg.kinds), uid)
    return {
      type: 'warm_library_estimate_result',
      jobs: estimate.jobs,
      cards: estimate.cards,
      inputTokensApprox: estimate.inputTokensApprox,
      breakdown: estimate.breakdown,
    }
  },
  warm_library_start: async (msg, uid) => ({
    type: 'warm_library_start_result',
    ...(await startWarmLibrary(normalizeWarmKinds(msg.kinds), uid)),
  }),
  warm_library_cancel: () => ({
    type: 'warm_library_cancel_result',
    ...cancelWarmLibrary(),
  }),
  resolve_character_by_name: async (msg, uid) => {
    const char = await resolveCharacter(msg.candidateIds || [], msg.name, uid)
    return {
      type: 'resolve_character_by_name_result',
      character: char ? await toSummary(char, true, uid) : null,
    }
  },
  create_card_draft: async (msg, uid) => {
    const { draft, context } = await draftCard(
      {
        seed: msg.seed,
        characterId: msg.characterId,
        draft: msg.draft,
        connectionId: msg.connectionId,
      },
      uid,
    )
    return { type: 'create_card_draft_result', draft, context }
  },
  create_card: async (msg, uid) => {
    const result = await createCardFromDraft(
      {
        draft: msg.draft,
        generateAvatar: msg.generateAvatar,
        generateGallery: msg.generateGallery,
        generateGreetings: msg.generateGreetings,
      },
      uid,
    )
    return {
      type: 'create_card_result',
      character: result.character,
      images: result.images,
    }
  },
  create_card_generate_images: async (msg, uid) => {
    const imageIds = await generateCharacterImages({
      characterId: msg.characterId,
      kind: msg.kind,
      userId: uid,
    })
    return {
      type: 'create_card_generate_images_result',
      characterId: msg.characterId,
      imageIds,
    }
  },
  create_card_surprise: async (msg, uid) => {
    const batch = await surpriseCards(
      { count: msg.count, connectionId: msg.connectionId },
      uid,
    )
    return {
      type: 'create_card_surprise_result',
      cards: batch.cards,
      requested: batch.requested,
      failed: batch.failed,
    }
  },
}

function isKnownType(type: string): type is RequestType {
  return Object.prototype.hasOwnProperty.call(handlers, type)
}

function reply(payload: BackendToFrontend, uid?: string): void {
  spindle.sendToFrontend(payload, uid)
}

function error(
  requestId: string,
  message: string,
  uid?: string,
  code?: string,
): void {
  reply({ type: 'error', requestId, message, code }, uid)
}

function ariError(err: unknown): string {
  if (err instanceof GenerateError || err instanceof RpcError) {
    return err.message
  }
  if (err instanceof Error) {
    return `I could not finish that. ${err.message}`
  }
  return 'I could not finish that. Something went wrong.'
}

function requestIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const id = (payload as { requestId?: unknown }).requestId
  return typeof id === 'string' ? id : null
}

export async function handleFrontendMessage(
  payload: unknown,
  userId: string,
): Promise<void> {
  const uid = userId || undefined
  noteUserContext(uid)
  if (!isFrontendMessage(payload) || !isKnownType(payload.type)) {
    const requestId = requestIdOf(payload)
    if (requestId) {
      error(requestId, 'I do not recognize that request.', uid, 'unknown_type')
    }
    return
  }

  const { requestId } = payload
  try {
    const handler = handlers[payload.type] as AnyHandler
    const result = await handler(payload, uid)
    reply({ ...result, requestId } as BackendToFrontend, uid)
  } catch (err) {
    error(
      requestId,
      ariError(err),
      uid,
      err instanceof RpcError ? err.code : undefined,
    )
  }
}

export function startRpc(): () => void {
  return spindle.onFrontendMessage((payload, userId) => {
    void handleFrontendMessage(payload, userId)
  })
}

export function __setTinderModeForTests(mode: TinderMode): void {
  setActiveTinderMode(mode)
}
