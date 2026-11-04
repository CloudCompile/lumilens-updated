import type { SpindleFrontendContext } from 'lumiverse-spindle-types'
import type { CharacterDraft, CharacterSummary, CreateCardImages } from '../shared/types'
import { createAriAvatarEl } from './ari-avatar'
import type { AriStore } from './ari-store'
import { icons } from './icons'
import { createIntro, CREATE_LOADING, CREATE_SAVED } from './phrases'
import { openQuickView } from './quick-view'
import type { RpcClient } from './rpc-client'
import { art, button, errorMessage, h, loadingFrom, tagRow } from './ui'

type CreateView = 'form' | 'drafting' | 'draft' | 'creating' | 'created'

type CreatedInfo = { character: CharacterSummary; images: CreateCardImages }

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
  let busy = false
  let error: string | null = null
  let runToken = 0

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
    return h('div', { class: 'll-page-body' }, [
      h('div', { class: 'll-intro' }, [
        createAriAvatarEl(ari.url, 'll-avatar ll-avatar-lg'),
        h('div', { class: 'll-intro-text', text: createIntro() }),
      ]),
      h('div', { class: 'll-form' }, [
        h('div', {}, [
          h('div', { class: 'll-field-label', text: 'The seed' }),
          h('div', { class: 'll-muted', text: 'One line is plenty. A vibe, a premise, a what if.' }),
          seedInput,
        ]),
        draftBtn,
      ]),
    ])
  }

  function draftingView(): HTMLElement {
    return loadingFrom(ari, CREATE_LOADING)
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
                h('div', { class: 'll-create-greeting-index', text: `Greeting ${i + 1}` }),
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
        h('div', { class: 'll-muted' }, [contextSourceId ? 'Based on one of your cards.' : 'Fresh from the seed.']),
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
        h('div', { class: 'll-error', text: 'I could not save that card. Try the draft again.' }),
      ])
    }
    const images = created.images
    const imageNotes: Array<HTMLElement> = [
      h(
        'div',
        { class: 'll-muted', text: images.avatar ? 'Avatar generated and saved.' : 'Avatar was not generated.' },
      ),
    ]
    if (images.gallery.length > 0) {
      imageNotes.push(
        h('div', { class: 'll-muted', text: `Gallery images saved: ${images.gallery.length}.` }),
      )
    }
    if (images.greetings.length > 0) {
      imageNotes.push(
        h('div', { class: 'll-muted', text: `Greeting images saved: ${images.greetings.length}.` }),
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

  function buildView(): HTMLElement {
    if (error) {
      const body = view === 'form' ? formView() : view === 'draft' ? draftView() : view === 'created' ? createdView() : draftingView()
      return h('div', { class: 'll-page-body' }, [h('div', { class: 'll-error', text: error }), body])
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
      })
      if (token !== runToken) return
      draft = res.draft
      contextSourceId = res.context.sourceCharacterId
      view = 'draft'
      render()
    } catch (e) {
      if (token !== runToken) return
      busy = false
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
      showError(errorMessage(e, 'I could not save that card. Try again.'))
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
        ...(kind === 'gallery' ? { gallery: res.imageIds } : { greetings: res.imageIds }),
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

  return {
    destroy: () => {
      runToken++
      busy = false
      root.replaceChildren()
    },
  }
}
