import type { RegexRule } from '../shared/comparisonRules'
import type { NormalizePair } from './regexDiff'
import './comparisonRules.css'

export interface ComparisonRulesDialogOptions {
  rules: RegexRule[]
  validate: (rules: RegexRule[]) => Promise<unknown>
  normalizePair: NormalizePair
}

/** Edits a draft; only a successful Apply returns new active rules. */
export function openComparisonRules(options: ComparisonRulesDialogOptions): Promise<RegexRule[] | null> {
  return new Promise(resolve => {
    const rules = options.rules.map(rule => ({ ...rule }))
    const dialog = document.createElement('dialog')
    dialog.className = 'folder-dialog comparison-rules-dialog'
    dialog.setAttribute('aria-labelledby', 'comparison-rules-title')
    const heading = document.createElement('h2')
    heading.id = 'comparison-rules-title'; heading.textContent = 'Comparison rules'
    const body = document.createElement('div'); body.className = 'folder-dialog-body'
    const help = document.createElement('p')
    help.textContent = 'Ignore matched text on each original line. Rust Regex syntax; no look-around or backreferences. Newlines and source files stay unchanged. Up to 20 rules, 1,024 characters each; 10 MiB per side.'
    const rows = document.createElement('div'); rows.className = 'comparison-rule-rows'
    const errors = new Map<string, string>()
    const button = (label: string, action: () => void) => {
      const element = document.createElement('button')
      element.type = 'button'; element.textContent = label; element.onclick = action
      return element
    }
    const message = document.createElement('p'); message.setAttribute('role', 'status')
    message.className = 'comparison-rules-message'
    let revision = 0, busy = false, closed = false
    const finish = (value: RegexRule[] | null) => {
      if (closed) return
      closed = true; dialog.close(); dialog.remove(); resolve(value)
    }
    const draw = () => {
      rows.replaceChildren()
      for (const [index, rule] of rules.entries()) {
        const row = document.createElement('div'); row.className = 'comparison-rule-row'
        const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = rule.enabled
        toggle.setAttribute('aria-label', `Enable rule ${index + 1}`)
        toggle.onchange = () => { rule.enabled = toggle.checked; revision++ }
        const pattern = document.createElement('input'); pattern.type = 'text'; pattern.value = rule.pattern
        pattern.spellcheck = false; pattern.placeholder = 'timestamp=\\S+'; pattern.setAttribute('aria-label', `Rule ${index + 1} pattern`)
        const error = document.createElement('span'); error.className = 'comparison-rule-error'
        error.textContent = errors.get(rule.id) ?? ''; error.id = `rule-error-${rule.id}`
        pattern.setAttribute('aria-describedby', error.id)
        pattern.setAttribute('aria-invalid', String(errors.has(rule.id)))
        pattern.oninput = () => {
          rule.pattern = pattern.value; revision++; errors.delete(rule.id)
          error.textContent = ''; pattern.setAttribute('aria-invalid', 'false')
        }
        const remove = button('Remove', () => {
          rules.splice(index, 1); revision++; draw()
          // Redrawing removes the focused button; continue at the nearest remaining rule.
          const nextRow = rows.children[Math.min(index, rules.length - 1)]
          const nextPattern = nextRow?.querySelector<HTMLInputElement>('input[type=text]')
          ;(nextPattern ?? add).focus()
        })
        row.append(toggle, pattern, remove, error); rows.append(row)
      }
      add.disabled = busy || rules.length >= 20
    }
    const add = button('Add rule', () => {
      if (rules.length >= 20) return
      rules.push({ id: crypto.randomUUID(), pattern: '', enabled: true }); revision++; draw()
      rows.lastElementChild?.querySelector<HTMLInputElement>('input[type=text]')?.focus()
    })
    const label = document.createElement('label'); label.textContent = 'Test text'
    const sample = document.createElement('textarea'); sample.rows = 3; sample.id = 'comparison-rules-sample'
    label.htmlFor = sample.id; sample.placeholder = 'Paste sample text to preview ignored content'
    const preview = document.createElement('pre'); preview.className = 'comparison-rules-preview'
    preview.setAttribute('aria-label', 'Normalized test text')
    const validate = async (): Promise<boolean> => {
      const current = revision
      errors.clear()
      await Promise.all(rules.map(async rule => {
        try { await options.validate([rule]) }
        catch (error) { errors.set(rule.id, String(error)) }
      }))
      if (closed || current !== revision) return false
      draw()
      if (errors.size) { message.textContent = 'Fix the highlighted rules before applying.'; return false }
      try { await options.validate(rules); return current === revision && !closed }
      catch (error) { message.textContent = String(error); return false }
    }
    const test = button('Test rules', () => { void (async () => {
      try {
        if (!await validate()) return
        const current = revision
        const result = await options.normalizePair(sample.value, sample.value, rules)
        if (closed || current !== revision) return
        preview.textContent = result.left.text
        message.textContent = result.reason ?? 'Preview removes matching text; original files are unchanged.'
      } catch (error) { message.textContent = String(error) }
    })() })
    const footer = document.createElement('div'); footer.className = 'folder-dialog-footer'
    const apply = button('Apply', () => { void (async () => {
      busy = true; apply.disabled = true; add.disabled = true
      try { if (await validate()) finish(rules.map(rule => ({ ...rule }))) }
      finally { busy = false; apply.disabled = false; add.disabled = rules.length >= 20 }
    })() })
    footer.append(button('Cancel', () => finish(null)), apply)
    body.append(help, rows, add, label, sample, test, preview, message)
    dialog.append(heading, body, footer)
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null) })
    dialog.addEventListener('close', () => { if (!closed) finish(null) })
    document.body.append(dialog); draw(); dialog.showModal()
  })
}
