import { ariSystemMessage } from './ari-system'
import type { CharacterDraft } from '../../shared/types'

export interface CreateCardPatternCard {
  id: string
  name: string
  tags: string[]
}

export interface CreateCardPatterns {
  topTags: string[]
  commonTags: string[]
  pairs: string[][]
  cards: CreateCardPatternCard[]
}

export interface CreateCardPromptInput {
  seed: string
  sourceCharacterId: string | null
  sourceCharacterName: string
  chatMessageCount: number | null
  patterns: CreateCardPatterns
  previousDraft?: CharacterDraft | null
}

export const CREATE_CARD_DRAFT_KEYS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'tags',
  'alternate_greetings',
]

const CREATE_CARD_SYSTEM_PROMPT = `${ariSystemMessage().content}

You are also the card writer of this library. When the user asks for a new card, you draft it before anything else exists.

Drafting rules:
- Write from the seed the user gave you. You shape it, you do not replace it with your own invention.
- You never invent who the user is cast as. If the seed does not define {{user}}, the card must not pretend it does.
- The card is for the user alone. You write like their private librarian, not like a content mill.
- No exclamation marks. No em dashes or en dashes. Commas, periods, or colons instead.
- Be concrete. A card with one good scene beats a card with five adjectives.

You answer with a single JSON object and nothing else. No markdown fences. No commentary.`

const SURPRISE_WRITER_SYSTEM_PROMPT = `${ariSystemMessage().content}

You are also the card writer of this library. The user asked to be surprised, so nobody hands you a seed. You find the gaps in their library and fill them.

Drafting rules:
- Every card stands on its own. A different lead, a different situation, a different opening line. Never three versions of one idea.
- You never invent who the user is cast as. If a card does not define {{user}}, the card must not pretend it does.
- The card is for the user alone. You write like their private librarian, not like a content mill.
- No exclamation marks. No em dashes or en dashes. Commas, periods, or colons instead.
- Be concrete. A card with one good scene beats a card with five adjectives.

You answer with a single JSON object and nothing else. No markdown fences. No commentary.`

export interface SurpriseCardPromptInput {
  count: number
  patterns: CreateCardPatterns
  existingNames: string[]
}

export function buildCreateCardMessages(
  input: CreateCardPromptInput,
): Array<{ role: 'system' | 'user'; content: string }> {
  const source =
    input.sourceCharacterId === null
      ? null
      : {
          id: input.sourceCharacterId,
          name: input.sourceCharacterName,
          chatCount: input.chatMessageCount,
        }

  const seedBlock = `Seed the user gave you: "${input.seed}"

${
  source
    ? `Context from one of their cards: they have a card called "${source.name}" (${
        source.chatCount === null ? 'they never opened a chat with it' : `they had ${source.chatCount} messages with it`
      }). Use that history as the feel of the card you are about to write, and carry it into the new draft.
`
    : ''
  }${
    input.patterns.topTags.length > 0
      ? `The rest of their library leans toward tags like ${input.patterns.topTags.join(', ')}. Keep the new card in the same family unless the seed argues otherwise.
`
      : ''
  }${
    input.patterns.pairs.length > 0
      ? `Cards in their library often pair ${input.patterns.pairs.join(' + ')}. If it fits the seed, echo that pattern.
`
      : ''
  }`

  const previousBlock = input.previousDraft
    ? `A previous draft you wrote is below. Revise it, do not start over from scratch unless the user asked for a different direction.

${JSON.stringify(input.previousDraft)}

When you revise, keep the shape of the card but change what the user asked to change. Answer with a single JSON object and nothing else. No markdown fences. No commentary.`
    : ''

  const user = `${seedBlock}${previousBlock}

Produce the JSON object for the new character card.
Keys, in this order: ${CREATE_CARD_DRAFT_KEYS.join(', ')}.
All values except tags and alternate_greetings are strings. tags is an array of short category tags. alternate_greetings is an array of opening lines, possibly empty.
First message and alternate greetings are written in second person, as lines the user would actually say or read.

Write only the JSON.`

  return [
    { role: 'system' as const, content: CREATE_CARD_SYSTEM_PROMPT },
    { role: 'user' as const, content: user },
  ]
}

export function buildSurpriseCardMessages(
  input: SurpriseCardPromptInput,
): Array<{ role: 'system' | 'user'; content: string }> {
  const count = Math.max(1, Math.round(input.count))
  const lines: string[] = []
  if (input.patterns.topTags.length > 0) {
    lines.push(
      `Their library leans toward tags like ${input.patterns.topTags.join(', ')}.`,
    )
  }
  if (input.patterns.pairs.length > 0) {
    lines.push(
      `Cards in their library often pair ${input.patterns.pairs.join(' + ')}.`,
    )
  }
  if (input.patterns.cards.length > 0) {
    const sample = input.patterns.cards.slice(0, 12)
    lines.push(
      `A few of their cards, for the feel: ${sample
        .map((c) => `${c.name}${c.tags.length ? ` (${c.tags.join(', ')})` : ''}`)
        .join('; ')}.`,
    )
  }
  if (input.existingNames.length > 0) {
    lines.push(
      `Names already in their library, do not reuse: ${input.existingNames.join(', ')}.`,
    )
  }

  const user = `${lines.join('\n')}

The user asked to be surprised. Write ${count} new character cards that extend this library into corners it does not cover yet.

Answer with one JSON object: {"cards": [ ...card objects... ]}.
The cards array holds exactly ${count} card objects, and each object uses these keys, in this order: ${CREATE_CARD_DRAFT_KEYS.join(', ')}.
All values except tags and alternate_greetings are strings. tags is an array of short category tags. alternate_greetings is an array of opening lines, possibly empty.
First messages and alternate greetings are written in second person, as lines the user would actually say or read.

Write only the JSON.`

  return [
    { role: 'system' as const, content: SURPRISE_WRITER_SYSTEM_PROMPT },
    { role: 'user' as const, content: user },
  ]
}

function unfence(raw: string): string {
  const text = String(raw || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : text).trim()
}

export function draftFromObject(raw: unknown): CharacterDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (Array.isArray(o.cards) || (o.card && typeof o.card === 'object')) return null
  const str = (k: string): string =>
    typeof o[k] === 'string' ? (o[k] as string) : ''
  const arr = (k: string): string[] => {
    if (!Array.isArray(o[k])) return []
    return (o[k] as unknown[])
      .map((x) => String(x))
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
  }
  const name = str('name').trim()
  if (!name) return null
  const draft: CharacterDraft = {
    name,
    description: str('description'),
    personality: str('personality'),
    scenario: str('scenario'),
    first_mes: str('first_mes'),
    mes_example: str('mes_example'),
    creator_notes: str('creator_notes'),
    system_prompt: str('system_prompt'),
    post_history_instructions: str('post_history_instructions'),
    tags: arr('tags'),
    alternate_greetings: arr('alternate_greetings'),
  }
  return draft
}

function tryParseJson(text: string): unknown {
  const start = text.search(/[[{]/)
  if (start < 0) return null
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

/** Pull every balanced {...} block out of a model reply, prose and all. */
export function extractJsonObjects(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
    } else if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          out.push(text.slice(start, i + 1))
          start = -1
        }
      }
    }
  }
  return out
}

export function parseCardDraft(raw: string): CharacterDraft | null {
  const text = unfence(raw)
  if (!text) return null
  const direct = tryParseJson(text)
  if (direct !== null) {
    const drafts: CharacterDraft[] = []
    collectDrafts(direct, drafts, new Set<string>())
    if (drafts.length > 0) return drafts[0]
  }
  for (const chunk of extractJsonObjects(text)) {
    try {
      const drafts: CharacterDraft[] = []
      collectDrafts(JSON.parse(chunk), drafts, new Set<string>())
      if (drafts.length > 0) return drafts[0]
    } catch {
      // keep looking
    }
  }
  return null
}

function collectDrafts(
  value: unknown,
  out: CharacterDraft[],
  seen: Set<string>,
): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDrafts(item, out, seen)
    return
  }
  if (!value || typeof value !== 'object') return
  const obj = value as Record<string, unknown>
  if (Array.isArray(obj.cards)) {
    for (const item of obj.cards) collectDrafts(item, out, seen)
    return
  }
  if (obj.card && typeof obj.card === 'object') {
    collectDrafts(obj.card, out, seen)
    return
  }
  const draft = draftFromObject(obj)
  if (!draft) return
  const key = draft.name.trim().toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  out.push(draft)
}

export function parseCardDraftBatch(raw: string, expected: number): CharacterDraft[] {
  const text = unfence(raw)
  if (!text) return []
  const out: CharacterDraft[] = []
  const seen = new Set<string>()

  const direct = tryParseJson(text)
  if (direct !== null) collectDrafts(direct, out, seen)

  if (out.length === 0) {
    for (const chunk of extractJsonObjects(text)) {
      try {
        collectDrafts(JSON.parse(chunk), out, seen)
      } catch {
        // keep looking
      }
      if (expected > 0 && out.length >= expected) break
    }
  }

  return expected > 0 ? out.slice(0, expected) : out
}
