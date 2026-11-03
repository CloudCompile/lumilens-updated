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

export function parseCardDraft(raw: string): CharacterDraft | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : text).trim()
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(candidate.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const o = parsed as Record<string, unknown>
    const str = (k: string): string =>
      typeof o[k] === 'string' ? (o[k] as string) : ''
    const arr = (k: string): string[] => {
      if (!Array.isArray(o[k])) return []
      return o[k]
        .map((x) => String(x))
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
    }
    const draft: CharacterDraft = {
      name: str('name') || 'Unnamed',
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
    if (!draft.name.trim()) return null
    return draft
  } catch {
    return null
  }
}
