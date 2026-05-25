import type { SyncBackend } from "@hubble.md/sync";
import { api } from "@hubble.md/sync-backend";
import type { Id } from "@hubble.md/sync-backend/types";
import { ConvexClient, ConvexHttpClient } from "convex/browser";

export type Subscriber = {
	onFilesChanged(
		workspaceId: string,
		callback: () => void,
		onError: (err: Error) => void,
	): () => void;
	onAssetsChanged(
		workspaceId: string,
		callback: () => void,
		onError: (err: Error) => void,
	): () => void;
	close(): Promise<void>;
};

export function createConvexBackend(url: string): SyncBackend {
	const client = new ConvexHttpClient(url);
	return {
		async getWorkspace(name) {
			const workspace = await client.query(api.sync.getWorkspace, { name });
			return workspace?._id ?? null;
		},
		async createWorkspace(name) {
			return client.mutation(api.sync.createWorkspace, { name });
		},
		async getFiles(workspaceId, since) {
			return client.query(api.sync.getFilesByWorkspace, {
				workspaceId: workspaceId as Id<"workspaces">,
				since,
			});
		},
		async pushFile(args) {
			await client.mutation(api.sync.pushFile, {
				...args,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async softDeleteFile(args) {
			await client.mutation(api.sync.softDeleteFile, {
				...args,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async getAssets(workspaceId, since) {
			return client.query(api.sync.getAssetsByWorkspace, {
				workspaceId: workspaceId as Id<"workspaces">,
				since,
			});
		},
		async pushAsset(args) {
			await client.mutation(api.sync.pushAsset, {
				...args,
				workspaceId: args.workspaceId as Id<"workspaces">,
				storageId: args.storageId as Id<"_storage">,
			});
		},
		async softDeleteAsset(args) {
			await client.mutation(api.sync.softDeleteAsset, {
				...args,
				workspaceId: args.workspaceId as Id<"workspaces">,
			});
		},
		async generateAssetUploadUrl() {
			return client.mutation(api.sync.generateAssetUploadUrl, {});
		},
		async getAssetDownloadUrl(storageId) {
			return client.query(api.sync.getAssetDownloadUrl, {
				storageId: storageId as Id<"_storage">,
			});
		},
	};
}

export function createConvexSubscriber(url: string): Subscriber {
	const client = new ConvexClient(url);
	return {
		onFilesChanged(workspaceId, callback, onError) {
			// Convex's onUpdate fires immediately with current state, then on
			// every change. We invoke `callback` for every fire — including the
			// initial — so the consumer can use it as the canonical source of
			// file-list state without an extra fetch and without a race window
			// where changes during subscription setup get dropped.
			return client.onUpdate(
				api.sync.getFilesByWorkspace,
				{ workspaceId: workspaceId as Id<"workspaces"> },
				() => callback(),
				onError,
			);
		},
		onAssetsChanged(workspaceId, callback, onError) {
			return client.onUpdate(
				api.sync.getAssetsByWorkspace,
				{ workspaceId: workspaceId as Id<"workspaces"> },
				() => callback(),
				onError,
			);
		},
		async close() {
			await client.close();
		},
	};
}
