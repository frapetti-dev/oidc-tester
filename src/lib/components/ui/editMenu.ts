import { contextMenu } from '#lib/state/contextMenu.svelte.js';
import type { MenuEntry } from './menu';

type TextControl = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES: Record<string, true> = {
	text: true,
	search: true,
	url: true,
	email: true,
	tel: true,
	password: true,
	number: true
};

/** True for enabled `textarea`s and text-like `input`s (the targets of the custom edit menu). */
export function isEditableText(target: EventTarget | null): target is TextControl {
	if (target instanceof HTMLTextAreaElement) return !target.disabled;
	return (
		target instanceof HTMLInputElement && !target.disabled && Object.hasOwn(TEXT_TYPES, target.type)
	);
}

function selectionRange(el: TextControl): [number, number] {
	// Number inputs report null selection offsets.
	return el.selectionStart === null || el.selectionEnd === null
		? [0, el.value.length]
		: [el.selectionStart, el.selectionEnd];
}

function replaceRange(el: TextControl, text: string, start: number, end: number) {
	el.focus();
	if (el.selectionStart !== null) el.setRangeText(text, start, end, 'end');
	else el.value = el.value.slice(0, start) + text + el.value.slice(end);
	el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Cut / Copy / Paste / Select all / Clear for one text control. */
export function editMenu(el: TextControl): MenuEntry[] {
	const [start, end] = selectionRange(el);
	const selected = el.value.slice(start, end);
	const readonly = el.readOnly;
	const isPassword = el instanceof HTMLInputElement && el.type === 'password';

	return [
		{
			label: 'Cut',
			shortcut: 'Ctrl+X',
			disabled: readonly || isPassword || selected === '',
			onselect: async () => {
				await contextMenu.copy(selected);
				replaceRange(el, '', start, end);
			}
		},
		{
			label: 'Copy',
			shortcut: 'Ctrl+C',
			disabled: isPassword || selected === '',
			onselect: () => contextMenu.copy(selected)
		},
		{
			label: 'Paste',
			shortcut: 'Ctrl+V',
			disabled: readonly,
			onselect: async () => {
				try {
					replaceRange(el, await navigator.clipboard.readText(), start, end);
				} catch {
					contextMenu.say('Paste is blocked here; use Ctrl+V');
				}
			}
		},
		'separator',
		{
			label: 'Select all',
			shortcut: 'Ctrl+A',
			onselect: () => {
				el.focus();
				el.select();
			}
		},
		{
			label: 'Clear',
			disabled: readonly || el.value === '',
			onselect: () => replaceRange(el, '', 0, el.value.length)
		}
	];
}
