import { Window } from 'happy-dom'
import { beforeEach, describe, expect, test } from 'bun:test'
import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { CreateCardResult, ConnectionInfo } from '../../shared/types'
import { AriStore } from '../ari-store'
import { mountCreateCard } from '../create-card'
import { openQuickView } from '../quick-view'
import type { RpcClient } from '../rpc-client'

type Call = { type: string; [key: string]: unknown }

function result(name: string): CreateCardResult {
  return {
    character: {
      id: `id-${name}`,
      name,
      description: '',
      tags: ['Test'],
      creator: '',
      creator_notes: '',
      image_id: null,
      imageUrl: null,
    },
    images: { avatar: null, gallery: [], greetings: [] },
  }
}

function setup(handler: (call: Call) => unknown) {
  const window = new Window({ url: 'https://lumiverse.local/' })
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    HTMLInputElement: window.HTMLInputElement,
    HTMLSelectElement: window.HTMLSelectElement,
    Element: window.Element,
    Node: window.Node,
    MouseEvent: window.MouseEvent,
    Event: window.Event,
  })

  const calls: Call[] = []
  const rpc = {
    request: async (body: Call) => {
      calls.push(body)
      return handler(body)
    },
  } as unknown as RpcClient

  const root = document.createElement('div')
  document.body.appendChild(root)
  const mounted = mountCreateCard({
    ctx: {} as SpindleFrontendContext,
    rpc,
    ari: new AriStore(),
    openQuickView,
    root,
  })
  return { root, calls, mounted, window }
}

function buttons(root: HTMLElement): HTMLButtonElement[] {
  return [...root.querySelectorAll('button')] as HTMLButtonElement[]
}

function findButton(root: HTMLElement, label: string): HTMLButtonElement {
  const found = buttons(root).find((b) => (b.textContent || '').includes(label))
  if (!found) throw new Error(`No button labelled ${label}`)
  return found
}

const connections: ConnectionInfo[] = [
  {
    id: 'conn-1',
    name: 'Fast',
    provider: 'openai',
    model: 'gpt-fast',
    is_default: true,
    has_api_key: true,
  },
  {
    id: 'conn-2',
    name: 'Sharp',
    provider: 'anthropic',
    model: 'claude',
    is_default: false,
    has_api_key: true,
  },
]

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('create card page', () => {
  beforeEach(() => {
    // Each test installs its own happy-dom window in setup().
  })

  test('paints the form on mount instead of leaving the page blank', async () => {
    const { root } = setup((call) =>
      call.type === 'list_connections'
        ? { type: 'list_connections_result', connections: [] }
        : {},
    )
    await settle()

    const text = root.textContent || ''
    expect(text).toContain('The seed')
    expect(text).toContain('Surprise me')
    expect(text).toContain('Drafting model')
    expect(root.querySelector('textarea')).not.toBeNull()
  })

  test('lists connections in the drafting model select', async () => {
    const { root } = setup((call) =>
      call.type === 'list_connections'
        ? { type: 'list_connections_result', connections }
        : {},
    )
    await settle()

    const select = [...root.querySelectorAll('select')].find((s) =>
      (s.getAttribute('aria-label') || '').includes('Drafting model'),
    )
    expect(select).toBeTruthy()
    expect(select?.textContent).toContain('Sharp')
    expect(select?.textContent).toContain('claude')
  })

  test('surprise me asks for three cards and shows them saved', async () => {
    const { root, calls } = setup((call) => {
      if (call.type === 'list_connections') {
        return { type: 'list_connections_result', connections }
      }
      if (call.type === 'create_card_surprise') {
        return {
          type: 'create_card_surprise_result',
          cards: [result('Ash Harbor'), result('Static Saint')],
          requested: 3,
          failed: 1,
        }
      }
      throw new Error(`unexpected ${call.type}`)
    })
    await settle()

    findButton(root, 'Surprise me').click()
    await settle()

    const call = calls.find((c) => c.type === 'create_card_surprise')
    expect(call?.count).toBe(3)
    expect(call?.connectionId).toBeUndefined()

    const text = root.textContent || ''
    expect(text).toContain('Saved 2 new cards')
    expect(text).toContain('Ash Harbor')
    expect(text).toContain('Static Saint')
    expect(text).toContain('1 did not make it')
  })

  test('sends the picked model with the surprise request', async () => {
    const { root, calls, window } = setup((call) => {
      if (call.type === 'list_connections') {
        return { type: 'list_connections_result', connections }
      }
      if (call.type === 'create_card_surprise') {
        return {
          type: 'create_card_surprise_result',
          cards: [result('Sharp Card')],
          requested: 3,
          failed: 2,
        }
      }
      throw new Error(`unexpected ${call.type}`)
    })
    await settle()

    const select = [...root.querySelectorAll('select')].find((s) =>
      (s.getAttribute('aria-label') || '').includes('Drafting model'),
    ) as HTMLSelectElement | undefined
    expect(select).toBeTruthy()
    if (select) {
      select.value = 'conn-2'
      select.dispatchEvent(new window.Event('change') as unknown as Event)
    }

    findButton(root, 'Surprise me').click()
    await settle()

    const call = calls.find((c) => c.type === 'create_card_surprise')
    expect(call?.connectionId).toBe('conn-2')
  })

  test('changes the count that surprise asks for', async () => {
    const { root, calls, window } = setup((call) => {
      if (call.type === 'list_connections') {
        return { type: 'list_connections_result', connections }
      }
      if (call.type === 'create_card_surprise') {
        return {
          type: 'create_card_surprise_result',
          cards: [result('One')],
          requested: 5,
          failed: 4,
        }
      }
      throw new Error(`unexpected ${call.type}`)
    })
    await settle()

    const countSelect = [...root.querySelectorAll('select')].find((s) =>
      (s.getAttribute('aria-label') || '').includes('How many cards'),
    ) as HTMLSelectElement | undefined
    expect(countSelect).toBeTruthy()
    if (countSelect) {
      countSelect.value = '5'
      countSelect.dispatchEvent(new window.Event('change') as unknown as Event)
    }

    findButton(root, 'Surprise me').click()
    await settle()

    const call = calls.find((c) => c.type === 'create_card_surprise')
    expect(call?.count).toBe(5)
  })

  test('drafts a seeded card and sends the picked model', async () => {
    const { root, calls, window } = setup((call) => {
      if (call.type === 'list_connections') {
        return { type: 'list_connections_result', connections }
      }
      if (call.type === 'create_card_draft') {
        return {
          type: 'create_card_draft_result',
          draft: {
            name: 'Keeper',
            description: 'Storms',
            personality: '',
            scenario: '',
            first_mes: 'Hello.',
            mes_example: '',
            creator_notes: '',
            system_prompt: '',
            post_history_instructions: '',
            tags: ['Cozy'],
            alternate_greetings: [],
          },
          context: {
            sourceCharacterId: null,
            sourceCharacterName: '',
            chatMessageCount: null,
            patternSummary: '',
          },
        }
      }
      throw new Error(`unexpected ${call.type}`)
    })
    await settle()

    const modelSelect = [...root.querySelectorAll('select')].find((s) =>
      (s.getAttribute('aria-label') || '').includes('Drafting model'),
    ) as HTMLSelectElement | undefined
    if (modelSelect) {
      modelSelect.value = 'conn-1'
      modelSelect.dispatchEvent(new window.Event('change') as unknown as Event)
    }

    findButton(root, 'Have Ari draft the card').click()
    await settle()

    const call = calls.find((c) => c.type === 'create_card_draft')
    expect(call?.connectionId).toBe('conn-1')
    expect(root.textContent).toContain('Draft for Keeper')
  })

  test('shows the error and stays usable when surprise fails', async () => {
    const { root } = setup((call) => {
      if (call.type === 'list_connections') {
        return { type: 'list_connections_result', connections }
      }
      if (call.type === 'create_card_surprise') {
        throw new Error('I could not dream up cards this time.')
      }
      throw new Error(`unexpected ${call.type}`)
    })
    await settle()

    findButton(root, 'Surprise me').click()
    await settle()

    expect(root.textContent).toContain('I could not dream up cards')
    expect(findButton(root, 'Surprise me')).toBeTruthy()
  })
})
