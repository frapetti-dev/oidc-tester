import { page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { contextMenu } from '#lib/state/contextMenu.svelte.js';
import { render } from 'vitest-browser-svelte';
import Fixture from './ContextMenuHost.fixture.svelte';

afterEach(() => (contextMenu.current = null));

// Item labels carry their shortcut ("Cut Ctrl+X"), so match by substring.
const menuitem = (name: string) => page.getByRole('menuitem', { name, exact: false });

function rightClick(element: Element) {
	const event = new MouseEvent('contextmenu', {
		bubbles: true,
		cancelable: true,
		clientX: 60,
		clientY: 60
	});
	element.dispatchEvent(event);
	return event;
}

describe('ContextMenuHost', () => {
	it('REQ-UI-010 text fields get Cut/Copy/Paste/Select all/Clear', async () => {
		await render(Fixture, { initial: 'hello world' });
		const input = page.getByLabelText('Field');
		rightClick(input.element());
		for (const name of ['Cut', 'Copy', 'Paste', 'Select all', 'Clear']) {
			await expect.element(menuitem(name)).toBeVisible();
		}
		// nothing is selected: Cut and Copy are disabled, Clear is not
		await expect.element(menuitem('Cut')).toBeDisabled();
		await expect.element(menuitem('Copy')).toBeDisabled();
		await menuitem('Clear').click();
		await expect.poll(() => page.getByTestId('mirror').element().textContent).toBe('');
		expect((input.element() as HTMLInputElement).value).toBe('');
	});

	it('REQ-UI-010 password fields disable Copy and Cut', async () => {
		await render(Fixture, { type: 'password', initial: 'secret' });
		const input = page.getByLabelText('Field').element() as HTMLInputElement;
		input.focus();
		input.select();
		rightClick(input);
		await expect.element(menuitem('Copy')).toBeDisabled();
		await expect.element(menuitem('Cut')).toBeDisabled();
		await expect.element(menuitem('Paste')).toBeEnabled();
	});

	it('REQ-UI-010 readonly fields disable Cut, Paste and Clear', async () => {
		await render(Fixture, { readonly: true, initial: 'fixed' });
		const input = page.getByLabelText('Field').element() as HTMLInputElement;
		input.focus();
		input.select();
		rightClick(input);
		await expect.element(menuitem('Copy')).toBeEnabled();
		for (const name of ['Cut', 'Paste', 'Clear']) {
			await expect.element(menuitem(name)).toBeDisabled();
		}
	});

	it('REQ-UI-010 default menu is suppressed elsewhere', async () => {
		await render(Fixture, {});
		const event = rightClick(page.getByTestId('plain').element());
		expect(event.defaultPrevented).toBe(true);
		expect(page.getByRole('menu').elements()).toHaveLength(0);
	});

	it('REQ-UI-009 Escape closes the menu and returns focus to the field', async () => {
		await render(Fixture, {});
		const input = page.getByLabelText('Field').element() as HTMLInputElement;
		rightClick(input);
		await expect.element(page.getByRole('menu')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		expect(page.getByRole('menu').elements()).toHaveLength(0);
		expect(document.activeElement).toBe(input);
	});
});
