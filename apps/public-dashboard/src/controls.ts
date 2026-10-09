import { phrase } from '@openbed/labels';
import { categoryLabel } from './labels.js';
import { ATTRIBUTION_LINK_TEXT, ATTRIBUTION_PREFIX, LGA_POINTS, OSM_COPYRIGHT_URL } from './lga-points.js';
import { WARD_SYNONYMS, WARD_VALUES, type SortChoice } from './search.js';

/**
 * THE SEARCH CONTROLS (R-2026-10-09 GO, C). Built ONCE, into the host element index.html provides outside
 * #app, so the poll's re-render of the results can never wipe a selection, close a list or take focus from
 * a control. After the build, the page changes a control only in answer to a visitor's action: the poll
 * calls setCoverage, setAgedOrder and nothing else here.
 *
 * TWO SEARCHABLE COMBOBOXES, "What kind of bed?" and "Near where?": a labelled input, a listbox, the active
 * option named by aria-activedescendant, and a "Clear search" button when typed text matches nothing.
 *   - A SELECTION HAPPENS ONLY on a pointer click on an option, or Enter on the active option. Never on
 *     typing, never on the arrow keys, never on blur.
 *   - Escape or blur closes the list and puts the input's text back to the current selection's label.
 *   - Both option lists are FIXED TABLES built at mount. Typing hides the options that do not match and
 *     shows the ones that do; it never adds or removes one, and a poll never touches either.
 *   - Typed text is matched against each option's label and synonyms and is never echoed into the page, a
 *     message or the address.
 *
 * THE LIVE REGION. Only the location status is one. The coverage line is not, so a poll that changes its
 * numerals does not interrupt a screen reader mid-sentence.
 */

export interface ControlsView {
  /** The chosen ward: "any" or an enum value. */
  readonly ward: string;
  /** The chosen area's slug, or null. */
  readonly area: string | null;
  /** What the starting point is, or null when there is none. */
  readonly origin: { readonly kind: 'device' } | { readonly kind: 'area'; readonly label: string } | null;
  readonly sort: SortChoice;
}

export interface ControlHandlers {
  readonly onWard: (ward: string) => void;
  readonly onArea: (slug: string | null) => void;
  readonly onNearMe: () => void;
  readonly onClear: () => void;
  readonly onSort: (sort: SortChoice) => void;
  readonly onCopy: () => void;
}

export interface Controls {
  /** Show a state the visitor chose. Never called by a poll. */
  sync(view: ControlsView): void;
  /** The location status (a live region): a failure sentence, or "Link copied". Empty text clears it. */
  setStatus(text: string): void;
  /** The coverage line's text, or null to leave the line empty. Called on every draw, in place. */
  setCoverage(text: string | null): void;
  /** The aged-order line's text, or null to hide it. Called on every draw, in place. */
  setAgedOrder(text: string | null): void;
  /** The line under the share button: which of the two share notes applies. */
  setShareNote(text: string): void;
}

interface ComboOption {
  readonly value: string;
  readonly label: string;
  readonly terms: readonly string[];
}

interface Combo {
  readonly input: HTMLInputElement;
  /** Show a selection without calling the handler. */
  show(value: string): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls !== undefined) node.className = cls;
  Object.assign(node, rest);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

function buildCombo(opts: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ComboOption[];
  readonly noMatch: string;
  readonly initial: string;
  readonly onSelect: (value: string) => void;
}): { readonly field: HTMLElement; readonly combo: Combo } {
  const field = el('div', { class: 'field combo-field' });
  const label = el('label', { htmlFor: `${opts.id}-input`, textContent: opts.label });
  const wrap = el('div', { class: 'combo' });
  const input = el('input', { id: `${opts.id}-input`, type: 'text', class: 'combo-input' }, {
    role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': `${opts.id}-list`, autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false',
  });
  const list = el('ul', { id: `${opts.id}-list`, class: 'combo-list', hidden: true }, { role: 'listbox', 'aria-label': opts.label });
  const optionNodes = opts.options.map((o, i) => {
    const li = el('li', { id: `${opts.id}-opt-${i}`, textContent: o.label, class: 'combo-option' }, { role: 'option', 'aria-selected': 'false' });
    li.dataset['value'] = o.value;
    return li;
  });
  list.append(...optionNodes);
  const none = el('div', { class: 'combo-none', hidden: true });
  const noneText = el('span', { textContent: opts.noMatch });
  const clearSearch = el('button', { type: 'button', textContent: phrase('clear_search'), class: 'link-button' });
  none.append(noneText, clearSearch);
  wrap.append(input, list, none);
  field.append(label, wrap);

  let selected = opts.initial;
  let active = -1;
  const labelOf = (value: string): string => opts.options.find((o) => o.value === value)?.label ?? '';
  const visible = (): number[] => optionNodes.flatMap((n, i) => (n.hidden ? [] : [i]));
  const setActive = (index: number): void => {
    active = index;
    optionNodes.forEach((n, i) => n.classList.toggle('is-active', i === index));
    if (index >= 0) input.setAttribute('aria-activedescendant', optionNodes[index]?.id ?? '');
    else input.removeAttribute('aria-activedescendant');
  };
  const open = (): void => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const close = (): void => {
    list.hidden = true;
    none.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    setActive(-1);
  };
  const markSelected = (): void => {
    optionNodes.forEach((n) => n.setAttribute('aria-selected', n.dataset['value'] === selected ? 'true' : 'false'));
  };
  /**
   * Hide the options that do not match what was typed; "" shows all of them. A match is a WORD PREFIX: the typed text begins one of the
   * words of the option's label or of one of its synonyms ("mat" finds maternity and not "premature", "intensive care" finds a
   * phrase), and every punctuation mark counts as a space. Typed text is only ever compared here; it is never stored or shown.
   */
  const words = (t: string): string => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
  const filter = (typed: string): void => {
    const needle = words(typed).trim();
    opts.options.forEach((o, i) => {
      const node = optionNodes[i];
      if (node === undefined) return;
      node.hidden = needle !== '' && !o.terms.some((t) => words(t).includes(` ${needle}`));
    });
    none.hidden = visible().length > 0 || list.hidden;
  };
  const restore = (): void => {
    input.value = labelOf(selected);
    filter('');
  };
  const choose = (index: number): void => {
    const option = opts.options[index];
    if (option === undefined) return;
    selected = option.value;
    markSelected();
    restore();
    close();
    opts.onSelect(option.value);
  };

  input.addEventListener('input', () => {
    open();
    filter(input.value);
    const first = visible()[0];
    setActive(first === undefined ? -1 : first);
  });
  input.addEventListener('click', () => {
    if (list.hidden) {
      open();
      setActive(opts.options.findIndex((o) => o.value === selected));
    }
  });
  input.addEventListener('keydown', (e) => {
    const shown = visible();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) {
        open();
        setActive(opts.options.findIndex((o) => o.value === selected));
        return;
      }
      if (shown.length === 0) return;
      const at = shown.indexOf(active);
      const next = e.key === 'ArrowDown' ? (at + 1) % shown.length : (at <= 0 ? shown.length - 1 : at - 1);
      setActive(shown[next] ?? -1);
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        choose(active);
      }
    } else if (e.key === 'Escape') {
      restore();
      close();
    }
  });
  input.addEventListener('blur', () => {
    restore();
    close();
  });
  // A pointer press on the list or the "Clear search" button must not blur the input first, or the list
  // would close before the click lands.
  wrap.addEventListener('mousedown', (e) => {
    if (e.target !== input) e.preventDefault();
  });
  list.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('li');
    if (target === null) return;
    const index = optionNodes.indexOf(target as HTMLLIElement);
    if (index >= 0) choose(index);
  });
  clearSearch.addEventListener('click', () => {
    input.value = '';
    filter('');
    open();
    setActive(opts.options.findIndex((o) => o.value === selected));
    input.focus();
  });

  markSelected();
  input.value = labelOf(selected);
  return {
    field,
    combo: {
      input,
      show(value: string): void {
        selected = value;
        markSelected();
        restore();
      },
    },
  };
}

/** Mount the controls into `host` and return the handle the page drives them with. */
export function mountControls(host: HTMLElement, handlers: ControlHandlers, initial: ControlsView): Controls {
  const wardOptions: ComboOption[] = [
    { value: 'any', label: phrase('any_ward'), terms: [phrase('any_ward').toLowerCase(), 'any', 'all'] },
    ...WARD_VALUES.map((value) => {
      const label = categoryLabel(value);
      return { value, label, terms: [label.toLowerCase(), value.toLowerCase().replace(/_/g, ' '), ...(WARD_SYNONYMS[value] ?? [])] };
    }),
  ];
  const areaOptions: ComboOption[] = [
    { value: '', label: phrase('any_area'), terms: [phrase('any_area').toLowerCase(), 'anywhere', 'lagos'] },
    ...LGA_POINTS.map((p) => ({ value: p.slug, label: p.label, terms: [p.label.toLowerCase(), p.slug.replace(/-/g, ' ')] })),
  ];

  const ward = buildCombo({
    id: 'ward', label: phrase('ward_label'), options: wardOptions, noMatch: phrase('no_match_ward'), initial: initial.ward,
    onSelect: (v) => handlers.onWard(v),
  });
  const area = buildCombo({
    id: 'area', label: phrase('area_label'), options: areaOptions, noMatch: phrase('no_match_area'), initial: initial.area ?? '',
    onSelect: (v) => handlers.onArea(v === '' ? null : v),
  });
  const nearMe = el('button', { type: 'button', id: 'near-me', class: 'near-me', textContent: phrase('near_me') });
  nearMe.addEventListener('click', () => handlers.onNearMe());
  const areaRow = el('div', { class: 'area-row' });
  areaRow.append(area.field, nearMe);

  const attribution = el('p', { id: 'area-attribution', class: 'attribution' });
  const osm = el('a', { href: OSM_COPYRIGHT_URL, textContent: ATTRIBUTION_LINK_TEXT, rel: 'noopener noreferrer', target: '_blank' });
  attribution.append(ATTRIBUTION_PREFIX, osm);

  const originLine = el('p', { id: 'origin-line', class: 'origin-line', hidden: true });
  const originText = el('span', { id: 'origin-text' });
  const clear = el('button', { type: 'button', id: 'origin-clear', class: 'link-button', textContent: phrase('origin_clear') }, { 'aria-label': phrase('origin_clear_name') });
  clear.addEventListener('click', () => {
    handlers.onClear();
    area.combo.input.focus();
  });
  originLine.append(originText, ' ', clear);

  const status = el('p', { id: 'location-status', class: 'location-status' }, { role: 'status', 'aria-live': 'polite' });

  const orderRow = el('div', { class: 'order-row' });
  const orderLabel = el('label', { htmlFor: 'order-select', class: 'visually-hidden', textContent: phrase('order_label') });
  const orderSelect = el('select', { id: 'order-select', class: 'order-select' });
  const orderExplain = el('p', { id: 'order-explain', class: 'order-explain' });
  orderRow.append(orderLabel, orderSelect, orderExplain);
  orderSelect.addEventListener('change', () => handlers.onSort(orderSelect.value === 'nearest' ? 'nearest' : 'default'));

  const coverage = el('p', { id: 'coverage', class: 'coverage' });
  const aged = el('p', { id: 'aged-order', class: 'aged-order', hidden: true });

  const shareRow = el('div', { class: 'share-row' });
  const copy = el('button', { type: 'button', id: 'copy-link', class: 'link-button', textContent: phrase('copy_link') });
  copy.addEventListener('click', () => handlers.onCopy());
  const shareNote = el('p', { id: 'share-note', class: 'share-note' });
  shareRow.append(copy, shareNote);

  host.replaceChildren(ward.field, areaRow, attribution, originLine, status, orderRow, coverage, aged, shareRow);

  /** The order select's options for this view; "Nearest first" only while there is an origin. */
  const setOrderOptions = (view: ControlsView): void => {
    const wardChosen = view.ward !== 'any';
    const wantNearest = view.origin !== null;
    const first = orderSelect.options[0];
    const defaultLabel = wardChosen ? phrase('order_recent') : phrase('order_name');
    if (first === undefined) {
      orderSelect.add(new Option(defaultLabel, 'default'));
    } else if (first.textContent !== defaultLabel) {
      first.textContent = defaultLabel;
    }
    const hasNearest = orderSelect.options.length > 1;
    if (wantNearest && !hasNearest) orderSelect.add(new Option(phrase('order_nearest'), 'nearest'));
    if (!wantNearest && hasNearest) orderSelect.remove(1);
    orderSelect.value = view.sort === 'nearest' && wantNearest ? 'nearest' : 'default';
    const explain = view.sort === 'nearest' && wantNearest
      ? phrase('order_nearest_explain')
      : wardChosen
        ? view.origin !== null ? phrase('order_recent_near_explain') : phrase('order_recent_name_explain')
        : '';
    orderExplain.textContent = explain;
    orderExplain.hidden = explain === '';
  };

  const sync = (view: ControlsView): void => {
    ward.combo.show(view.ward);
    area.combo.show(view.area ?? '');
    setOrderOptions(view);
    if (view.origin === null) {
      originLine.hidden = true;
      originText.textContent = '';
    } else {
      originLine.hidden = false;
      originText.textContent = view.origin.kind === 'device' ? phrase('origin_device') : phrase('origin_area', { lga: view.origin.label });
    }
  };
  sync(initial);

  return {
    sync,
    setStatus(text: string): void {
      if (status.textContent !== text) status.textContent = text;
    },
    setCoverage(text: string | null): void {
      const next = text ?? '';
      if (coverage.textContent !== next) coverage.textContent = next;
    },
    setAgedOrder(text: string | null): void {
      if (text === null) {
        aged.hidden = true;
        if (aged.textContent !== '') aged.textContent = '';
        return;
      }
      aged.hidden = false;
      if (aged.textContent !== text) aged.textContent = text;
    },
    setShareNote(text: string): void {
      if (shareNote.textContent !== text) shareNote.textContent = text;
    },
  };
}
