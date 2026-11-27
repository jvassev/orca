import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view'

// A path such as `/Users/me` is prose, not a command.
const LEADING_COMMAND = /^\/[^\s/]+(?=\s|$)/
const FENCE = /^\s*```/
const QUOTE = /^\s*>/

const COMMAND_CLASS = 'font-semibold text-chat-foreground-strong'
const FENCE_CLASS = 'bg-chat-code-surface px-2 font-mono text-chat-code-foreground'
const QUOTE_CLASS = 'border-l-2 border-chat-code-border pl-2 text-chat-foreground-faint'

function lineStart(line: ProseMirrorNode): string {
  const first = line.firstChild
  return first?.isText ? (first.text ?? '') : ''
}

/** Styles the draft's leading `/command`, ``` fences and `>` quotes; the text stays plain markdown. */
export function promptMarkdownDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = []
  const first = doc.firstChild
  const command = first ? LEADING_COMMAND.exec(lineStart(first)) : null
  if (command) {
    decorations.push(Decoration.inline(1, 1 + command[0].length, { class: COMMAND_CLASS }))
  }
  let inFence = false
  // The composer holds one paragraph per line.
  doc.forEach((line, pos) => {
    const text = lineStart(line)
    const isFence = FENCE.test(text)
    let cls: string | null = null
    if (inFence || isFence) {
      cls = isFence ? `${FENCE_CLASS} ${inFence ? 'rounded-b-md' : 'rounded-t-md'}` : FENCE_CLASS
    } else if (QUOTE.test(text)) {
      cls = QUOTE_CLASS
    }
    if (cls) {
      decorations.push(Decoration.node(pos, pos + line.nodeSize, { class: cls }))
    }
    if (isFence) {
      inFence = !inFence
    }
  })
  return DecorationSet.create(doc, decorations)
}

const key = new PluginKey<DecorationSet>('nativeChatPromptMarkdownDecorations')

// A composition can end with no further doc change; restyle once it has.
function requestRescan(view: EditorView): void {
  setTimeout(() => {
    if (!view.isDestroyed && !view.composing) {
      view.dispatch(view.state.tr.setMeta(key, true).setMeta('addToHistory', false))
    }
  })
}

export const NativeChatPromptMarkdownDecorations = Extension.create({
  name: 'nativeChatPromptMarkdownDecorations',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => promptMarkdownDecorations(state.doc),
          apply: (tr, previous) => {
            if (!tr.docChanged && tr.getMeta(key) !== true) {
              return previous
            }
            // Why: redecorating mid-composition re-renders the IME's text node.
            if (tr.getMeta('composition') !== undefined) {
              return previous.map(tr.mapping, tr.doc)
            }
            return promptMarkdownDecorations(tr.doc)
          }
        },
        props: {
          decorations: (state) => key.getState(state),
          handleDOMEvents: {
            compositionend: (view) => {
              requestRescan(view)
              return false
            }
          }
        }
      })
    ]
  }
})
