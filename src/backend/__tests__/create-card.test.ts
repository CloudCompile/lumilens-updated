import { beforeEach, describe, expect, test } from 'bun:test'
import { getLibrary, type CharacterDTO } from '../characters'
import {
  MAX_SURPRISE_CARDS,
  analyzeTagPatterns,
  clampSurpriseCount,
  createCardFromDraft,
  surpriseCards,
} from '../create-card'
import { generateRaw } from '../generate'
import {
  buildSurpriseCardMessages,
  extractJsonObjects,
  parseCardDraft,
  parseCardDraftBatch,
} from '../prompts/create-card'
import type { CharacterDraft } from '../../shared/types'
import {
  createSpindleMock,
  installSpindleMock,
  sampleCharacters,
} from './spindle-mock'

function draft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    name: 'Test Card',
    description: 'A test card',
    personality: 'Testy',
    scenario: 'A test',
    first_mes: 'Hello.',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    tags: ['Test'],
    alternate_greetings: [],
    ...overrides,
  }
}

describe('card creation prompts', () => {
  test('parseCardDraft reads a fenced reply', () => {
    const parsed = parseCardDraft(
      '```json\n{"name":"Keeper","description":"Storms","tags":["Cozy"]}\n```',
    )
    expect(parsed?.name).toBe('Keeper')
    expect(parsed?.tags).toEqual(['Cozy'])
  })

  test('parseCardDraft survives prose around the object', () => {
    const parsed = parseCardDraft(
      'Here you go.\n{"name":"Keeper","description":"Storms"}\nEnjoy.',
    )
    expect(parsed?.name).toBe('Keeper')
  })

  test('parseCardDraft unwraps a single card object', () => {
    expect(parseCardDraft('{"card":{"name":"Wrapped"}}')?.name).toBe('Wrapped')
  })

  test('parseCardDraft returns null when nothing parses', () => {    expect(parseCardDraft('')).toBeNull()
    expect(parseCardDraft('no json here')).toBeNull()
    expect(parseCardDraft('{"description":"no name"}')).toBeNull()
  })

  test('parseCardDraftBatch reads the cards wrapper', () => {
    const raw = JSON.stringify({
      cards: [
        { name: 'One', tags: ['a'] },
        { name: 'Two', tags: ['b'] },
      ],
    })
    const drafts = parseCardDraftBatch(raw, 5)
    expect(drafts.map((d) => d.name)).toEqual(['One', 'Two'])
  })

  test('parseCardDraftBatch reads a bare array and stops at count', () => {
    const raw = JSON.stringify([
      { name: 'One' },
      { name: 'Two' },
      { name: 'Three' },
    ])
    const drafts = parseCardDraftBatch(raw, 2)
    expect(drafts.map((d) => d.name)).toEqual(['One', 'Two'])
  })

  test('parseCardDraftBatch drops duplicates and junk', () => {
    const raw = `Warm up:
{"cards":[
  {"name":"One"},
  {"name":"one"},
  {"description":"nameless"},
  {"card":{"name":"Two"}}
]}
Thanks.`
    const drafts = parseCardDraftBatch(raw, 5)
    expect(drafts.map((d) => d.name)).toEqual(['One', 'Two'])
  })

  test('extractJsonObjects keeps nested objects whole', () => {
    expect(extractJsonObjects('x {"a":{"b":1}} y')).toEqual(['{"a":{"b":1}}'])
  })

  test('surprise prompt names the count and the existing cards', () => {
    const messages = buildSurpriseCardMessages({
      count: 3,
      patterns: {
        topTags: ['horror'],
        commonTags: ['horror'],
        pairs: [['horror', 'fantasy']],
        cards: [{ id: 'c1', name: 'Vampire Lord', tags: ['horror'] }],
      },
      existingNames: ['Vampire Lord'],
    })
    const user = messages[1].content
    expect(user).toContain('exactly 3')
    expect(user).toContain('Vampire Lord')
    expect(user).toContain('horror')
  })
})

describe('surprise card counts', () => {
  test('clampSurpriseCount keeps counts sane', () => {
    expect(clampSurpriseCount(0)).toBe(1)
    expect(clampSurpriseCount(-3)).toBe(1)
    expect(clampSurpriseCount(2.4)).toBe(2)
    expect(clampSurpriseCount(99)).toBe(MAX_SURPRISE_CARDS)
    expect(clampSurpriseCount('3')).toBe(3)
    expect(clampSurpriseCount('nope')).toBe(1)
  })
})

describe('analyzeTagPatterns', () => {
  test('counts tags and pairs from the library', () => {
    const cards = sampleCharacters() as unknown as CharacterDTO[]
    const patterns = analyzeTagPatterns(cards)
    expect(patterns.topTags[0]).toBe('horror')
    expect(patterns.pairs[0]).toEqual(['horror', 'fantasy'])
    expect(patterns.cards).toHaveLength(3)
  })

  test('handles an empty library', () => {
    const patterns = analyzeTagPatterns([])
    expect(patterns.topTags).toEqual([])
    expect(patterns.commonTags).toEqual([])
    expect(patterns.cards).toEqual([])
  })
})

describe('surpriseCards', () => {
  let created: number

  beforeEach(() => {
    created = 0
  })

  function install(mock: ReturnType<typeof createSpindleMock>) {
    const api = installSpindleMock(mock)
    const characters = api.characters as unknown as {
      create?: (dto: Record<string, unknown>) => Promise<unknown>
      setAvatar?: () => Promise<void>
    }
    characters.create = async (dto) => {
      created++
      const char = {
        ...dto,
        id: `made-${created}`,
        image_id: null,
        created_at: created,
        updated_at: created,
      }
      api.__characters.push(char as never)
      return char
    }
    characters.setAvatar = async () => {}
    ;(
      api as unknown as {
        imageGen: {
          generate: () => Promise<{ imageDataUrl: string; imageId: string }>
        }
      }
    ).imageGen = {
      generate: async () => ({
        imageDataUrl: 'data:image/png;base64,eA==',
        imageId: `img-${created}`,
      }),
    }
    return api
  }

  test('invents the requested cards and saves all of them', async () => {
    const api = install(
      createSpindleMock({
        characters: [],
        generateContent: JSON.stringify({
          cards: [
            { name: 'Ash Harbor', description: 'A drowned port', tags: ['Cozy'] },
            { name: 'Static Saint', description: 'A radio ghost' },
            { name: 'Last Lighthouse', description: 'Keeper of storms' },
          ],
        }),
      }),
    )

    const batch = await surpriseCards({ count: 3 })

    expect(batch.requested).toBe(3)
    expect(batch.failed).toBe(0)
    expect(batch.cards.map((c) => c.character.name)).toEqual([
      'Ash Harbor',
      'Static Saint',
      'Last Lighthouse',
    ])
    expect(api.__characters).toHaveLength(3)
    expect(await getLibrary()).toHaveLength(3)
  })

  test('skips names the library already has', async () => {
    const api = install(
      createSpindleMock({
        characters: sampleCharacters(),
        generateContent: JSON.stringify({
          cards: [{ name: 'Vampire Lord' }, { name: 'Fresh Face' }],
        }),
      }),
    )

    const batch = await surpriseCards({ count: 2 })

    expect(batch.cards.map((c) => c.character.name)).toEqual(['Fresh Face'])
    expect(batch.failed).toBe(1)
    expect(api.__characters).toHaveLength(4)
  })

  test('clamps a greedy count before asking the model', async () => {
    let asked = ''
    const api = install(
      createSpindleMock({
        characters: [],
        generateContent: (messages) => {
          asked = String((messages[1] as { content: string }).content)
          return JSON.stringify({ cards: [{ name: 'Only One' }] })
        },
      }),
    )

    const batch = await surpriseCards({ count: 40 })

    expect(batch.requested).toBe(MAX_SURPRISE_CARDS)
    expect(asked).toContain('exactly 5')
    expect(api.__characters).toHaveLength(1)
    expect(batch.failed).toBe(4)
  })

  test('fails clearly when the model returns no cards', async () => {
    install(
      createSpindleMock({
        characters: [],
        generateContent: 'I would rather not.',
      }),
    )
    await expect(surpriseCards({ count: 2 })).rejects.toThrow('dream up cards')
  })

  test('passes the chosen connection through to the model', async () => {
    const api = install(
      createSpindleMock({
        characters: [],
        generateContent: JSON.stringify({ cards: [{ name: 'Connected' }] }),
      }),
    )
    const quiet = api.generate.quiet as unknown as (opts: {
      connection_id?: string
      messages: unknown[]
    }) => Promise<unknown>
    let seen: string | undefined
    ;(
      api.generate as unknown as {
        quiet: (opts: {
          connection_id?: string
          messages: unknown[]
        }) => Promise<unknown>
      }
    ).quiet = async (opts) => {
      seen = opts.connection_id
      return quiet(opts)
    }

    await surpriseCards({ count: 1, connectionId: 'conn-42' })

    expect(seen).toBe('conn-42')
  })
})

describe('createCardFromDraft', () => {
  test('saves the card even when the avatar fails', async () => {
    const api = installSpindleMock(
      createSpindleMock({ characters: [], generateContent: 'ok' }),
    )
    const characters = api.characters as unknown as {
      create?: (dto: Record<string, unknown>) => Promise<unknown>
      setAvatar?: () => Promise<void>
    }
    characters.create = async (dto) => {
      const char = { ...dto, id: 'saved-1', image_id: null }
      api.__characters.push(char as never)
      return char
    }
    characters.setAvatar = async () => {}
    ;(
      api as unknown as {
        imageGen: { generate: () => Promise<never> }
      }
    ).imageGen = {
      generate: async () => {
        throw new Error('image backend down')
      },
    }

    const result = await createCardFromDraft({ draft: draft() })

    expect(result.character.id).toBe('saved-1')
    expect(result.images.avatar).toBeNull()
    expect(await getLibrary()).toHaveLength(1)
  })
})

describe('generateRaw connection override', () => {
  test('sends the override and falls back to settings otherwise', async () => {
    const api = installSpindleMock(
      createSpindleMock({ characters: [], generateContent: 'hello' }),
    )
    const seen: Array<string | undefined> = []
    ;(
      api.generate as unknown as {
        quiet: (opts: { connection_id?: string }) => Promise<unknown>
      }
    ).quiet = async (opts) => {
      seen.push(opts.connection_id)
      return { content: 'hello' }
    }

    await generateRaw([{ role: 'user', content: 'hi' }], undefined, 'create', 'conn-9')
    await generateRaw([{ role: 'user', content: 'hi' }], undefined, 'create')

    expect(seen).toEqual(['conn-9', undefined])
  })
})
