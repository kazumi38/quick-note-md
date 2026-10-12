export function directorySegments(directory: string): string[] {
	const segments = directory.replace(/\\/g, '/').split('/');
	if (!directory.trim() || segments.some(part => part === '..' || part === '.' || !part)
		|| /[:\0]/.test(directory)) {
		throw new Error('The legacy storage setting must be a workspace-relative folder path.');
	}
	return segments;
}
