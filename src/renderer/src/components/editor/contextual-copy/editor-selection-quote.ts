import type { editor, Selection } from 'monaco-editor'
import { formatNativeChatQuote } from '../../../../../shared/native-chat/input/quotes/native-chat-quote-selection'
import { formatSelectionReference } from './selection-copy'
import { installEditorAddSelectionToLastAgentShortcut } from '../commands/editor-shortcuts'
import { addQuoteToLastUsedAgent } from '../../native-chat/selection-quotes/add-quote-to-last-used-agent'

/** Every cursor's range, in document order, as one chat quote so multi-cursor and column selections keep them all. */
export function readEditorSelectionQuote(
  editorInstance: editor.ICodeEditor,
  relativePath: string,
  language: string
): { quote: string; lastSelection: Selection } | null {
  const model = editorInstance.getModel()
  const selections = (editorInstance.getSelections() ?? [])
    .filter((selection) => !selection.isEmpty())
    .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn)
  const lastSelection = selections.at(-1)
  if (!model || !lastSelection) {
    return null
  }
  const reference = selections
    .map((selection) =>
      formatSelectionReference({
        relativePath,
        language,
        selection,
        selectedText: model.getValueInRange(selection)
      })
    )
    .join('\n\n')
  return { quote: formatNativeChatQuote(reference), lastSelection }
}

export function installAddSelectionToLastAgentShortcut(
  editorInstance: editor.ICodeEditor,
  propsRef: { current: { relativePath: string; language: string; worktreeId?: string } }
): () => void {
  return installEditorAddSelectionToLastAgentShortcut(editorInstance.getContainerDomNode(), () => {
    const { worktreeId, relativePath, language } = propsRef.current
    // Text focus only: review-note drafts in view zones submit on the same chord.
    if (!worktreeId || !editorInstance.hasTextFocus()) {
      return false
    }
    const selectionQuote = readEditorSelectionQuote(editorInstance, relativePath, language)
    if (!selectionQuote) {
      return false
    }
    // Consumed even with no agent so the chord never edits the selection.
    addQuoteToLastUsedAgent(worktreeId, selectionQuote.quote)
    return true
  })
}
