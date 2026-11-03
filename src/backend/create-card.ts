import { generateRaw } from './generate'
import {
  getCharacter,
  getLibrary,
  invalidateLibrary,
  toSummary,
  type CharacterDTO,
} from './characters'
import { scoreCard, extractKeywords } from './picker'
import {
  buildCreateCardMessages,
  parseCardDraft,
  type CreateCardPatterns,
} from './prompts/create-card'
import type {
  CharacterDraft,
  CreateCardContext,
  CreateCardImages,
  CreateCardResult,
} from '../shared/types'

declare const spindle: import('lumiverse-spindle-types').SpindleAPI

export function analyzeTagPatterns(cards: CharacterDTO[]): CreateCardPatterns {
  const tagCount = new Map<string, number>()
  const pairCount = new Map<string, number>()
  const patternCards: CreateCardPatterns['cards'] = []

  for (const c of cards) {
    const tags = [
      ...new Set(
        (c.tags || [])
          .map((t) => String(t).trim())
          .filter(Boolean)
          .map((t) => t.toLowerCase()),
      ),
    ]
    patternCards.push({
      id: c.id,
      name: c.name || 'Unnamed',
      tags,
    })
    for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = `${tags[i]}|${tags[j]}`
        pairCount.set(key, (pairCount.get(key) || 0) + 1)
      }
    }
  }

  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t)
  const pairs = [...pairCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([key]) => key.split('|'))

  const commonTags = topTags.filter((t) => (tagCount.get(t) || 0) >= 2)
  const patternSummary =
    topTags.length > 0
      ? `Their library leans toward ${topTags.join(', ')}. Cards often pair ${pairs
          .map((p) => p.join(' + '))
          .join(', ') || 'no recurring pairs'}.`
      : 'Their library has no tag pattern to speak of yet.'

  return { topTags, commonTags, pairs, cards: patternCards }
}

export async function getChatMessageCount(
  characterId: string,
  userId?: string,
): Promise<number | null> {
  try {
    const res = await spindle.chats.list({
      characterId,
      ...(userId ? { userId } : {}),
    })
    const chats: Array<Record<string, unknown>> = Array.isArray(
      (res as { data?: unknown } | null | undefined)?.data,
    )
      ? ((res as unknown as { data: Array<Record<string, unknown>> }).data ?? [])
      : []
    let total = 0
    for (const chat of chats) {
      const meta = chat?.metadata
      const raw =
        chat?.message_count ??
        (meta && typeof meta === 'object'
          ? (meta as Record<string, unknown>).message_count
          : undefined)
      const n = Number(raw)
      if (Number.isFinite(n) && n > 0) total += Math.floor(n)
    }
    return total > 0 ? total : null
  } catch {
    return null
  }
}

export async function draftCard(input: {
  seed: string
  characterId?: string
  draft?: CharacterDraft
}, userId?: string): Promise<{ draft: CharacterDraft; context: CreateCardContext }> {
  const seed = String(input.seed || '').trim()
  let sourceCharacterId: string | null = null
  let sourceCharacterName = ''
  let chatMessageCount: number | null = null
  let source: CharacterDTO | null = null

  const all = await getLibrary(userId)
  let sourceId: string | undefined = input.characterId
  if (!sourceId && all.length > 0) {
    const scored = all
      .map((c) => ({ c, score: scoreCard(c, extractKeywords(seed)) }))
      .sort((a, b) => b.score - a.score)
      .find((x) => x.score > 0)
    sourceId = scored?.c.id
  }
  if (sourceId) {
    source = await getCharacter(sourceId, userId)
    sourceCharacterId = source?.id ?? sourceId
    sourceCharacterName = source?.name || sourceId
    chatMessageCount = source ? await getChatMessageCount(source.id, userId) : null
  }

  const patterns = analyzeTagPatterns(all)
  const messages = buildCreateCardMessages({
    seed,
    sourceCharacterId,
    sourceCharacterName,
    chatMessageCount,
    patterns,
    previousDraft: input.draft ?? null,
  })
  const text = await generateRaw(messages, userId, 'create')
  const parsed = parseCardDraft(text)
  if (!parsed) {
    throw new Error(
      'I could not shape a card from that seed. Try again with a little more to go on.',
    )
  }

  const context: CreateCardContext = {
    sourceCharacterId,
    sourceCharacterName,
    chatMessageCount,
    patternSummary:
      patterns.topTags.length > 0
        ? `Their library leans toward ${patterns.topTags.join(', ')}.`
        : 'Their library has no tag pattern to speak of yet.',
  }
  return { draft: parsed, context }
}

export async function generateCharacterImages(input: {
  characterId: string
  kind: 'gallery' | 'greetings'
  userId?: string
}): Promise<string[]> {
  const char = await getCharacter(input.characterId)
  if (!char) throw new Error('That character is gone.')
  const prompts: string[] = []
  if (input.kind === 'greetings') {
    const greetings = [char.first_mes, ...char.alternate_greetings]
      .map((g) => String(g || '').trim())
      .filter((g) => g.length > 0)
    for (const greeting of greetings) {
      prompts.push(`Greeting illustration for ${char.name}: ${greeting}`)
    }
  } else {
    prompts.push(
      `Scene illustration for ${char.name}: ${char.scenario || char.description}`,
      `Portrait illustration for ${char.name}: ${char.personality || char.description || char.scenario}`,
    )
  }
  const imageIds: string[] = []
  for (const prompt of prompts) {
    const img = await generateCharacterImage({
      prompt,
      ownerCharacterId: char.id,
      userId: input.userId,
    })
    if (img.imageId) imageIds.push(img.imageId)
  }
  return imageIds
}

async function generateCharacterImage(input: {
  prompt: string
  ownerCharacterId?: string
  userId?: string
}): Promise<{ imageDataUrl: string; imageId?: string }> {
  const result = (await spindle.imageGen.generate({
    prompt: input.prompt,
    ...(input.ownerCharacterId ? { owner_character_id: input.ownerCharacterId } : {}),
    ...(input.userId ? { userId: input.userId } : {}),
  })) as { imageDataUrl?: unknown; imageId?: unknown } | null
  return {
    imageDataUrl: typeof result?.imageDataUrl === 'string' ? result.imageDataUrl : '',
    imageId: typeof result?.imageId === 'string' ? result.imageId : undefined,
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = typeof atob === 'function' ? atob(base64) : ''
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export async function createCardFromDraft(input: {
  draft: CharacterDraft
  generateAvatar?: boolean
  generateGallery?: boolean
  generateGreetings?: boolean
}, userId?: string): Promise<CreateCardResult> {  const draft = input.draft
  const created = await spindle.characters.create(
    {
      name: draft.name,
      description: draft.description,
      personality: draft.personality,
      scenario: draft.scenario,
      first_mes: draft.first_mes,
      mes_example: draft.mes_example,
      creator_notes: draft.creator_notes,
      system_prompt: draft.system_prompt,
      post_history_instructions: draft.post_history_instructions,
      tags: draft.tags,
      alternate_greetings: draft.alternate_greetings,
      creator: '',
    },
    userId,
  )
  invalidateLibrary()
  const character = await toSummary(created, true, userId)

  const images: CreateCardImages = { avatar: null, gallery: [], greetings: [] }

  if (input.generateAvatar !== false && created.id) {
    const avatarImage = await generateCharacterImage({
      prompt: `Avatar illustration of ${draft.name}: ${draft.personality || draft.description || draft.scenario}`,
      ownerCharacterId: created.id,
      userId,
    })
    images.avatar = avatarImage.imageId ?? null
    if (avatarImage.imageDataUrl && created.id) {
      const bytes = dataUrlToBytes(avatarImage.imageDataUrl)
      await spindle.characters.setAvatar(
        created.id,
        { data: bytes, filename: 'avatar.png', mime_type: 'image/png' },
        userId,
      )
    }
  }

  if (input.generateGallery === true && created.id) {
    const scenes = [
      `Scene illustration for ${draft.name}: ${draft.scenario || draft.description}`,
      `Portrait illustration for ${draft.name}: ${draft.personality || draft.description || draft.scenario}`,
    ]
    for (const prompt of scenes) {
      const img = await generateCharacterImage({
        prompt,
        ownerCharacterId: created.id,
        userId,
      })
      if (img.imageId) images.gallery.push(img.imageId)
    }
  }

  if (input.generateGreetings === true && created.id) {
    const greetings = [draft.first_mes, ...draft.alternate_greetings]
      .map((g) => String(g || '').trim())
      .filter((g) => g.length > 0)
    for (const greeting of greetings) {
      const img = await generateCharacterImage({
        prompt: `Greeting illustration for ${draft.name}: ${greeting}`,
        ownerCharacterId: created.id,
        userId,
      })
      if (img.imageId) images.greetings.push(img.imageId)
    }
  }

  return { character, images }
}
