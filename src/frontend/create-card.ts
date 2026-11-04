import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type {
  CharacterDraft,
  CharacterSummary,
  ConnectionInfo,
  CreateCardImages,
  CreateCardResult,
} from '../shared/types'
import { createAriAvatarEl } from './ari-avatar'
import type { AriStore } from './ari-store'
import { icons } from './icons'
import {
  createIntro,
  CREATE_LOADING,
  CREATE_SAVED,
  CREATE_SURPRISE_LOADING,
} from './phrases'
import { openQuickView } from './quick-view'
import type { RpcClient } from './rpc-client'
import { art, button, errorMessage, h, loadingFrom, tagRow } from './ui'

type CreateView =
  | 'form'
  | 'drafting'
  | 'draft'
  | 'creating'
  | 'created'
  | 'surprising'
  | 'batch'

type CreatedInfo = { character: CharacterSummary; images: CreateCardImages }

const MAX_SURPRISE_CARDS = 5
const DEFAULT_SURPRISE_CARDS = 3

export function mountCreateCard(deps: {
  ctx: SpindleFrontendContext
  rpc: RpcClient
  ari: AriStore
  openQuickView: typeof openQuickView
  root: HTMLElement
}): { destroy: () => void } {
  const { ctx, root, rpc, ari } = deps
  let view: CreateView = 'form'
  let seed = ''
  let draft: CharacterDraft | null = null
  let contextSourceId: string | null = null
  let created: CreatedInfo | null = null
  let batch: CreateCardResult[] = []
  let batchFailed = 0
  let count = DEFAULT_SURPRISE_CARDS
  let modelValue = ''
  let connections: ConnectionInfo[] = []
  let autoSave = false
  let busy = false
  let error: string | null = null
  let runToken = 0

  const autoSaveCb = h('input', {
    type: 'checkbox',
    class: 'll-switch',
    'aria-label': 'Auto-save drafts',
    onchange: () => {
      autoSave = autoSaveCb.checked
    },
  })

  // One live select each, reused across renders so choices survive redraws.
  const modelSelect = h('select', {
    class: 'll-select',
    'aria-label': 'Drafting model',
    onchange: () => {
      modelValue = modelSelect.value
    },
  })
  modelSelect.append(h('option', { value: '', text: 'Default connection' }))

  const countSelect = h(
    'select',
    {
      class: 'll-select ll-create-count',
      'aria-label': 'How many cards',
      onchange: () => {
        count = normalizeCount(countSelect.value)
      },
    },
    Array.from({ length: MAX_SURPRISE_CARDS }, (_, i) =>
      h('option', {
        value: String(i + 1),
        text: `${i + 1} ${i === 0 ? 'card' : 'cards'}`,
      }),
    ),
  )
  countSelect.value = String(count)

  function normalizeCount(raw: unknown): number {
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_SURPRISE_CARDS
    return Math.min(MAX_SURPRISE_CARDS, Math.max(1, Math.round(n)))
  }

  async function loadConnections(): Promise<void> {
    try {
      const res = await rpc.request({ type: 'list_connections' })
      connections = res.connections
    } catch {
      connections = []
    }
    const current = modelSelect.value
    modelSelect.replaceChildren(
      h('option', { value: '', text: 'Default connection' }),
      ...connections.map((c) =>
        h('option', {
          value: c.id,
          text: `${c.name}${c.model ? ` · ${c.model}` : ''}${c.is_default ? ' (default)' : ''}${c.has_api_key ? '' : ' (no API key)'}`,
        }),
      ),
    )
    modelSelect.value = current
    modelValue = current
  }

  /** Only send a connection when one was actually picked. */
  function connectionArg(): { connectionId?: string } {
    return modelValue ? { connectionId: modelValue } : {}
  }

  function render(): void {
    root.replaceChildren(buildView())
  }

  function showError(message: string): void {
    error = message
    render()
  }

  function clearError(): void {
    error = null
    render()
  }

  function modelField(): HTMLElement {
    return h('div', { class: 'll-create-section' }, [
      h('div', { class: 'll-field-label', text: 'Drafting model' }),
      h('div', {
        class: 'll-muted',
        text: 'Which connection writes the card. Default follows your Settings.',
      }),
      modelSelect,
    ])
  }

  function formView(): HTMLElement {
    const seedInput = h('textarea', {
      class: 'll-textarea',
      placeholder: 'e.g. a lighthouse keeper who collects storms',
      rows: 4,
      oninput: (e) => {
        seed = (e.target as HTMLTextAreaElement).value
      },
    })
    seedInput.value = seed
    const draftBtn = button('Have Ari draft the card', {
      kind: 'primary',
      icon: icons.wand(16),
      onClick: () => void startDraft(false),
    })
    draftBtn.classList.add('ll-btn-block')
    const surpriseBtn = button('Surprise me', {
      kind: 'primary',
      icon: icons.dice(16),
      onClick: () => void runSurprise(),
    })
    return h('div', { class: 'll-page-body' }, [
      h('div', { class: 'll-intro' }, [
        createAriAvatarEl(ari.url, 'll-avatar ll-avatar-lg'),
        h('div', { class: 'll-intro-text', text: createIntro() }),
      ]),
      h('div', { class: 'll-form' }, [
        h('div', {}, [
          h('div', { class: 'll-field-label', text: 'The seed' }),
          h('div', {
            class: 'll-muted',
            text: 'One line is plenty. A vibe, a premise, a what if.',
          }),
          seedInput,
        ]),
        draftBtn,
        h('label', { class: 'll-switch-row' }, [
          h('div', {}, [
            h('div', { class: 'll-field-label', text: 'Auto-save drafts' }),
            h('div', {
              class: 'll-muted',
              text: 'Skip the review and save the card the moment Ari writes it.',
            }),
          ]),
          autoSaveCb,
        ]),
        h('div', { class: 'll-create-section' }, [
          h('div', { class: 'll-field-label', text: 'Surprise me' }),
          h('div', {
            class: 'll-muted',
            text: 'No seed needed. Ari invents cards from the shape of your library and saves them straight away.',
          }),
          h('div', { class: 'll-create-row' }, [countSelect, surpriseBtn]),
        ]),
        modelField(),
      ]),
    ])
  }

  function draftingView(): HTMLElement {
    return loadingFrom(ari, CREATE_LOADING)
  }

  function surprisingView(): HTMLElement {
    return loadingFrom(ari, CREATE_SURPRISE_LOADING)
  }

  function draftView(): HTMLElement {
    const d = draft
    if (!d) {
      return h('div', { class: 'll-page-body' }, [
        h('div', { class: 'll-error', text: 'I lost the draft. Start over.' }),
      ])
    }
    const fields: Array<HTMLElement> = []
    const rows: Array<[string, string]> = [
      ['Name', d.name],
      ['Description', d.description],
      ['Personality', d.personality],
      ['Scenario', d.scenario],
      ['First message', d.first_mes],
      ['Creator notes', d.creator_notes],
    ]
    for (const [label, value] of rows) {
      if (!value || !value.trim()) continue
      fields.push(
        h('div', { class: 'll-create-field' }, [
          h('div', { class: 'll-create-field-label', text: label }),
          h('div', { class: 'll-create-field-value', text: value }),
        ]),
      )
    }
    const greetings = d.alternate_greetings
      .map((g) => String(g || '').trim())
      .filter((g) => g.length > 0)
    if (greetings.length > 0) {
      fields.push(
        h('div', { class: 'll-create-greetings' }, [
          h('div', { class: 'll-create-field-label', text: 'Greetings' }),
          ...greetings.map(
            (g, i) =>
              h('div', { class: 'll-create-greeting' }, [
                h('div', {
                  class: 'll-create-greeting-index',
                  text: `Greeting ${i + 1}`,
                }),
                h('div', { class: 'll-create-field-value', text: g }),
              ]),
          ),
        ]),
      )
    }
    return h('div', { class: 'll-page-body' }, [
      h('div', { class: 'll-create-draft-head' }, [
        createAriAvatarEl(ari.url, 'll-avatar ll-avatar-sm'),
        h('div', { class: 'll-create-draft-title', text: `Draft for ${d.name}` }),
        h('div', { class: 'll-muted' }, [
          contextSourceId ? 'Based on one of your cards.' : 'Fresh from the seed.',
        ]),
      ]),
      ...fields,
      tagRow(d.tags, 8),
      h('div', { class: 'll-btn-row' }, [
        button('Create this card', {
          kind: 'primary',
          icon: icons.wand(16),
          onClick: () => void runCreate(),
        }),
        button('Ask Ari to revise', {
          kind: 'ghost',
          icon: icons.refresh(16),
          onClick: () => void startDraft(true),
        }),
      ]),
    ])
  }

  function createdView(): HTMLElement {
    const c = created?.character
    if (!created || !c) {
      return h('div', { class: 'll-page-body' }, [
        h('div', {
          class: 'll-error',
          text: 'I could not save that card. Try the draft again.',
        }),
      ])
    }
    const images = created.images
    const imageNotes: Array<HTMLElement> = [
      h('div', {
        class: 'll-muted',
        text: images.avatar
          ? 'Avatar generated and saved.'
          : 'Avatar was not generated.',
      }),
    ]
    if (images.gallery.length > 0) {
      imageNotes.push(
        h('div', {
          class: 'll-muted',
          text: `Gallery images saved: ${images.gallery.length}.`,
        }),
      )
    }
    if (images.greetings.length > 0) {
      imageNotes.push(
        h('div', {
          class: 'll-muted',
          text: `Greeting images saved: ${images.greetings.length}.`,
        }),
      )
    }
    const actions = [
      button('Open in Quick View', {
        kind: 'primary',
        icon: icons.search(16),
        onClick: () => {
          const id = created?.character.id
          if (id) void deps.openQuickView({ ctx, rpc, ari }, { characterId: id })
        },
      }),
    ]
    if (images.gallery.length === 0) {
      actions.push(
        button('Generate gallery art', {
          kind: 'primary',
          icon: icons.book(16),
          onClick: () => void runGenerateImages('gallery'),
        }),
      )
    }
    if (images.greetings.length === 0) {
      actions.push(
        button('Generate greeting art', {
          kind: 'primary',
          icon: icons.chat(16),
          onClick: () => void runGenerateImages('greetings'),
        }),
      )
    }
    return h('div', { class: 'll-page-body' }, [
      h('div', { class: 'll-create-saved' }, [
        art(c, 'll-qv-art'),
        h('div', {}, [
          h('div', { class: 'll-create-saved-title', text: `Created ${c.name}` }),
          h('div', { class: 'll-muted', text: CREATE_SAVED[0] }),
        ]),
      ]),
      ...imageNotes,
      ...actions,
      h('div', { class: 'll-btn-row' }, [
        button('Done', {
          kind: 'ghost',
          onClick: () => {
            view = 'form'
            clearError()
          },
        }),
      ]),
    ])
  }

  function batchView(): HTMLElement {
    if (batch.length === 0) {
      return h('div', { class: 'll-page-body' }, [
        h('div', {
          class: 'll-error',
          text: 'I could not save those cards. Try again.',
        }),
      ])
    }
    const rows = batch.map(({ character, images }) => {
      const meta = [
        character.tags.slice(0, 4).join(' · '),
        images.avatar ? 'avatar saved' : 'no avatar',
      ]
        .filter((x) => x.length > 0)
        .join(' · ')
      return h('div', { class: 'll-create-batch-row' }, [
        art(character, 'll-qv-art ll-create-batch-art'),
        h('div', { class: 'll-create-batch-body' }, [
          h('div', { class: 'll-create-saved-title', text: character.name }),
          h('div', { class: 'll-muted', text: meta }),
        ]),
        button('Open', {
          kind: 'ghost',
          icon: icons.search(16),
          onClick: () =>
            void deps.openQuickView(
              { ctx, rpc, ari },
              { characterId: character.id },
            ),
        }),
      ])
    })
    return h('div', { class: 'll-page-body' }, [
      h('div', { class: 'll-create-draft-head' }, [
        createAriAvatarEl(ari.url, 'll-avatar ll-avatar-sm'),
        h('div', {}, [
          h('div', {
            class: 'll-create-draft-title',
            text: `Saved ${batch.length} new ${batch.length === 1 ? 'card' : 'cards'}`,
          }),
          h('div', {
            class: 'll-muted',
            text:
              batchFailed > 0
                ? `${batchFailed} did not make it. These are in your library now.`
                : 'All of them are in your library now.',
          }),
        ]),
      ]),
      h('div', { class: 'll-create-batch' }, rows),
      h('div', { class: 'll-btn-row' }, [
        button('Surprise me with more', {
          kind: 'primary',
          icon: icons.dice(16),
          onClick: () => void runSurprise(),
        }),
        button('Done', {
          kind: 'ghost',
          onClick: () => {
            batch = []
            batchFailed = 0
            view = 'form'
            clearError()
          },
        }),
      ]),
    ])
  }

  function buildView(): HTMLElement {
    if (error) {
      const body =
        view === 'created'
          ? createdView()
          : view === 'batch'
            ? batchView()
            : view === 'draft'
              ? draftView()
              : formView()
      return h('div', { class: 'll-page-body' }, [
        h('div', { class: 'll-error', text: error }),
        body,
      ])
    }
    switch (view) {
      case 'drafting':
        return draftingView()
      case 'draft':
        return draftView()
      case 'creating':
        return draftingView()
      case 'created':
        return createdView()
      case 'surprising':
        return surprisingView()
      case 'batch':
        return batchView()
      default:
        return formView()
    }
  }

  async function startDraft(revision: boolean): Promise<void> {
    if (busy) return
    busy = true
    runToken++
    const token = runToken
    error = null
    view = 'drafting'
    render()
    try {
      const res = await rpc.request({
        type: 'create_card_draft',
        seed,
        ...(contextSourceId ? { characterId: contextSourceId } : {}),
        ...(revision && draft ? { draft } : {}),
        ...connectionArg(),
      })
      if (token !== runToken) return
      draft = res.draft
      contextSourceId = res.context.sourceCharacterId
      view = 'draft'
      busy = false
      if (autoSave) {
        await runCreate()
        return
      }
      render()
    } catch (e) {
      if (token !== runToken) return
      busy = false
      view = 'form'
      showError(errorMessage(e, 'I could not draft that card. Try again.'))
    }
    if (token === runToken) busy = false
  }

  async function runCreate(): Promise<void> {
    if (!draft || busy) return
    busy = true
    runToken++
    const token = runToken
    error = null
    view = 'creating'
    render()
    try {
      const res = await rpc.request({
        type: 'create_card',
        draft,
        generateAvatar: true,
        generateGallery: false,
        generateGreetings: false,
      })
      if (token !== runToken) return
      created = { character: res.character, images: res.images }
      view = 'created'
      render()
    } catch (e) {
      if (token !== runToken) return
      busy = false
      view = 'draft'
      showError(errorMessage(e, 'I could not save that card. Try again.'))
      return
    }
    if (token === runToken) busy = false
  }

  async function runSurprise(): Promise<void> {
    if (busy) return
    busy = true
    runToken++
    const token = runToken
    error = null
    batch = []
    batchFailed = 0
    view = 'surprising'
    render()
    try {
      const res = await rpc.request({
        type: 'create_card_surprise',
        count,
        ...connectionArg(),
      })
      if (token !== runToken) return
      batch = res.cards
      batchFailed = res.failed
      view = 'batch'
      render()
    } catch (e) {
      if (token !== runToken) return
      busy = false
      view = 'form'
      showError(
        errorMessage(e, 'I could not surprise you this time. Try again.'),
      )
      return
    }
    if (token === runToken) busy = false
  }

  async function runGenerateImages(kind: 'gallery' | 'greetings'): Promise<void> {
    if (!created || busy) return
    busy = true
    runToken++
    const token = runToken
    try {
      const res = await rpc.request({
        type: 'create_card_generate_images',
        characterId: created.character.id,
        kind,
      })
      if (token !== runToken) return
      created.images = {
        ...created.images,
        ...(kind === 'gallery'
          ? { gallery: res.imageIds }
          : { greetings: res.imageIds }),
      }
      render()
    } catch (e) {
      if (token !== runToken) return
      showError(errorMessage(e, 'I could not make those images. Try again.'))
    } finally {
      if (token === runToken) busy = false
    }
  }

  render()
  void loadConnections()

  return {
    destroy: () => {
      runToken++
      busy = false
      root.replaceChildren()
    },
  }
}
