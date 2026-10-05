import type { HttpExchange, ProxyMode } from '#lib/ipc/types.js';

export interface CurlSettings {
	tlsInsecure: boolean;
	proxy: { mode: ProxyMode; url: string };
}

/** Bash single-quoting: wrap in `'` and write embedded `'` as `'\''`. */
function quote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

/** REQ-TL-003: bash cURL command reproducing the recorded request. */
export function toCurl(exchange: HttpExchange, settings: CurlSettings): string {
	const { method, url, headers, body } = exchange.request;
	const args = ['curl', '-X', method, quote(url)];
	for (const [name, value] of headers) args.push('-H', quote(`${name}: ${value}`));
	if (body !== null && body !== '') args.push('--data-raw', quote(body));
	if (settings.tlsInsecure) args.push('-k');
	if (settings.proxy.mode === 'url' && settings.proxy.url !== '') {
		args.push('-x', quote(settings.proxy.url));
	} else if (settings.proxy.mode === 'none') {
		args.push('--noproxy', quote('*'));
	}
	return args.join(' ');
}
