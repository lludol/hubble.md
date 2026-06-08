export function dirname(filePath: string): string | null {
	const forwardSlash = filePath.lastIndexOf("/");
	const backSlash = filePath.lastIndexOf("\\");
	const separatorIndex = Math.max(forwardSlash, backSlash);
	if (separatorIndex < 0) return null;
	if (separatorIndex === 0) return filePath.slice(0, 1);
	return filePath.slice(0, separatorIndex);
}

export function extname(filePath: string): string {
	const name = filePath.split(/[\\/]/).pop() ?? filePath;
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot) : "";
}

export function joinPath(parent: string, name: string): string {
	const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
	return parent.endsWith("/") || parent.endsWith("\\")
		? `${parent}${name}`
		: `${parent}${separator}${name}`;
}

export function pathInFolder(path: string, folderPath: string): boolean {
	const prefix =
		folderPath.endsWith("/") || folderPath.endsWith("\\")
			? folderPath
			: `${folderPath}/`;
	return path.startsWith(prefix);
}
