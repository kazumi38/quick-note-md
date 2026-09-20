import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { DocumentStore } from './documents';
import { escapeHtml, maxEditLength, renderNote, validateRenderedEdit } from './rendering';

interface EditMessage {
	kind: 'edit';
	requestId: number;
	version: number;
	blockId: string;
	before: string;
	text: string;
}

export class NoteEditor implements vscode.CustomTextEditorProvider {
	public static readonly viewType = 'quick-note-md.rendered';
	public activeUri: vscode.Uri | undefined;
	private readonly panels = new Map<vscode.WebviewPanel, vscode.Uri>();
	private readonly recovery = new Map<string, { uri: string; active: boolean; text?: string }>();

	public constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly store: DocumentStore
	) {}

	public resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
		const uri = document.uri.toString();
		const previous = [...this.recovery].find(([, entry]) => entry.uri === uri && !entry.active);
		const recoveryId = previous?.[0] ?? randomBytes(16).toString('hex');
		const recovery = previous?.[1] ?? (this.recovery.size < 16 ? { uri, active: true, text: undefined } : undefined);
		if (recovery) { recovery.active = true; this.recovery.set(recoveryId, recovery); }
		this.panels.set(panel, document.uri);
		if (panel.active) { this.activeUri = document.uri; }
		const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
		panel.webview.options = { enableScripts: true, localResourceRoots: [media] };
		panel.webview.html = this.html(panel.webview, media);
		let disposed = false;
		let editing = false;
		let lastRequestId = 0;
		const render = () => {
			const result = renderNote(document.getText());
			if (!recovery) {
				const disable = (nodes: typeof result.nodes) => nodes.forEach(node => {
					delete node.blockId;
					if (node.children) { disable(node.children); }
				});
				disable(result.nodes);
				result.spans = [];
			}
			return result;
		};
		const sendSnapshot = () => {
			if (!disposed) {
				void panel.webview.postMessage({
					kind: 'snapshot', version: document.version, isDirty: document.isDirty, ...render()
				});
			}
		};
		const subscriptions: vscode.Disposable[] = [];
		subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document.uri.toString() === document.uri.toString() && !editing) {
				sendSnapshot();
			}
		}));
		subscriptions.push(vscode.workspace.onDidSaveTextDocument(saved => {
			if (saved.uri.toString() === document.uri.toString() && !editing) { sendSnapshot(); }
		}));
		subscriptions.push(panel.onDidChangeViewState(() => {
			this.activeUri = [...this.panels].find(([candidate]) => candidate.active)?.[1];
		}));
		subscriptions.push(panel.webview.onDidReceiveMessage(async (message: unknown) => {
			if (!message || typeof message !== 'object' || Array.isArray(message)) { return; }
			const request = message as Record<string, unknown>;
			if (typeof request.kind !== 'string' || 'uri' in request) { return; }
			if (request.kind === 'pending') {
				if (recovery && Object.keys(request).sort().join(',') === 'kind,text'
					&& (request.text === null || (typeof request.text === 'string' && request.text.length <= maxEditLength))) {
					recovery.text = request.text === null ? undefined : request.text as string;
				}
				return;
			}
			if (['ready', 'reload', 'showSource', 'undo', 'redo'].includes(request.kind)) {
				if (Object.keys(request).length !== 1) { return; }
				if (request.kind === 'ready' || request.kind === 'reload') {
					if (request.kind === 'ready') {
						lastRequestId = 0;
						if (recovery?.text !== undefined) {
							void panel.webview.postMessage({ kind: 'recovery', text: recovery.text });
						} else if (!recovery) {
							void panel.webview.postMessage({ kind: 'notice', message: '未保存入力の保管上限です。ほかのメモの入力を保存・回収してから開き直すか、生 Markdown を使用してください。' });
						}
					}
					sendSnapshot();
				} else if (request.kind === 'showSource') {
					await vscode.commands.executeCommand('quick-note-md.showSource', document.uri);
				} else if (!editing && panel.active) {
					// Route native history to this document, never whichever source editor happens to be active.
					await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
					await vscode.commands.executeCommand(request.kind);
					await vscode.commands.executeCommand('vscode.openWith', document.uri, NoteEditor.viewType);
				}
				return;
			}
			if (request.kind !== 'edit'
				|| Object.keys(request).sort().join(',') !== 'before,blockId,kind,requestId,text,version'
				|| !Number.isSafeInteger(request.requestId) || (request.requestId as number) <= lastRequestId
				|| !Number.isSafeInteger(request.version)
				|| typeof request.blockId !== 'string' || request.blockId.length > 64
				|| typeof request.before !== 'string' || typeof request.text !== 'string') {
				return;
			}
			const edit = request as unknown as EditMessage;
			lastRequestId = edit.requestId;
			let ownsEdit = false;
			try {
				if (!recovery || editing || document.version !== edit.version) {
					throw new Error('別の操作で内容が変わりました。入力をコピーしてから再読み込みしてください。');
				}
				const span = validateRenderedEdit(document.getText(), edit.blockId, edit.before, edit.text);
				editing = true;
				ownsEdit = true;
				const version = await this.store.edit(document.uri, edit.version, span.start, span.end, edit.before, edit.text);
				if (version !== document.version) {
					throw new Error('保存中に別の操作で内容が変わりました。入力をコピーしてから再読み込みしてください。');
				}
				if (!disposed) {
					await panel.webview.postMessage({
						kind: 'ack', requestId: edit.requestId, version, isDirty: document.isDirty,
						...render()
					});
				}
			} catch (error) {
				if (!disposed) {
					await panel.webview.postMessage({
						kind: 'conflict', requestId: edit.requestId,
						message: error instanceof Error ? error.message : '保存できません。入力を保持しています。'
					});
				}
			} finally {
				if (ownsEdit) { editing = false; }
			}
		}));
		panel.onDidDispose(() => {
			disposed = true;
			subscriptions.forEach(subscription => subscription.dispose());
			this.panels.delete(panel);
			if (recovery) {
				recovery.active = false;
				if (recovery.text === undefined) { this.recovery.delete(recoveryId); }
			}
			this.activeUri = [...this.panels].find(([candidate]) => candidate.active)?.[1];
		});
	}

	private html(webview: vscode.Webview, media: vscode.Uri): string {
		const nonce = randomBytes(24).toString('base64');
		const script = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.js'));
		const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'editor.css'));
		return `<!DOCTYPE html>
<html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<link nonce="${nonce}" rel="stylesheet" href="${escapeHtml(style.toString())}"></head>
<body><header><button id="source" type="button">生 Markdown を表示</button>
<button id="reload" type="button">再読み込み</button>
<p id="help">点線の本文は直接編集できます。その他の構造は読み取り専用です。通常は自動保存されます。既存の未保存変更は生 Markdown で確認して保存してください。</p>
<p id="status" role="status" aria-live="polite">読み込み中…</p>
<section id="recovery" hidden><label for="pending">未保存の入力（コピーして保管できます）</label>
<textarea id="pending" readonly></textarea>
<button id="discard" type="button">未保存の入力を破棄して再読み込み</button></section></header>
<main id="note" aria-label="レンダリングされたメモ" aria-describedby="help"></main>
<script nonce="${nonce}" src="${escapeHtml(script.toString())}"></script></body></html>`;
	}
}
