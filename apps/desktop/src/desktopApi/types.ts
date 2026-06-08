export type FileEntry = {
	path: string;
	modified_at: number;
};

export type PersistPastedImageInput = {
	filePath: string;
	bytes: number[];
	mimeType: string | null;
};

export type PersistPastedImageOutput = {
	relativeMarkdownPath: string;
	deduped: boolean;
};

export type WatchOptions = {
	recursive: boolean;
};

export type Unsubscribe = () => void;

export type MenuState = {
	hasWorkspace: boolean;
};

export type DesktopApi = {
	listDirectory(path: string): Promise<FileEntry[]>;
	readFileText(path: string): Promise<string>;
	writeFileText(path: string, content: string): Promise<void>;
	renameFile(fromPath: string, toPath: string): Promise<void>;
	persistPastedImage(
		input: PersistPastedImageInput,
	): Promise<PersistPastedImageOutput>;
	deleteFile(path: string, options?: { recursive?: boolean }): Promise<void>;
	readBinaryFile(path: string): Promise<number[]>;
	writeBinaryFile(path: string, bytes: number[]): Promise<void>;
	openFilePicker(options: { defaultPath?: string }): Promise<string | null>;
	openFolderPicker(): Promise<string | null>;
	saveMarkdownFilePicker(options: {
		defaultPath?: string;
	}): Promise<string | null>;
	watchPath(
		path: string,
		options: WatchOptions,
		callback: (paths: string[]) => void,
	): Promise<Unsubscribe>;
	openExternalUrl(url: string): Promise<void>;
	resolvePath(path: string): Promise<string>;
	toAssetUrl(path: string): string;
	getLaunchFilePath(): Promise<string | null>;
	setMenuState(state: MenuState): Promise<void>;
	onOpenFile(callback: (path: string) => void): Unsubscribe;
	onMenuCreateMarkdownFile(callback: () => void): Unsubscribe;
	onMenuOpenFile(callback: () => void): Unsubscribe;
	onMenuOpenFolder(callback: () => void): Unsubscribe;
	onMenuShowWorkspaceSwitcher(callback: () => void): Unsubscribe;
};
