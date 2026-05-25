import { useState } from "react";
import { disconnect, readConnection } from "./connection/connection";
import { ConnectScreen } from "./screens/ConnectScreen";
import { OpenWorkspaceScreen } from "./screens/OpenWorkspaceScreen";
import { AppShell } from "./shell/AppShell";

type Route =
	| { kind: "connect" }
	| { kind: "open-workspace"; url: string }
	| { kind: "shell"; url: string; workspaceId: string };

function initialRoute(): Route {
	const testRoute = readTestBootstrap();
	if (testRoute) return testRoute;

	const stored = readConnection();
	if (!stored) return { kind: "connect" };
	if (!stored.workspaceId) {
		return { kind: "open-workspace", url: stored.url };
	}
	return {
		kind: "shell",
		url: stored.url,
		workspaceId: stored.workspaceId,
	};
}

// Agent test bootstrap: navigating to /?test=1 skips the connect + workspace
// screens by reading VITE_TEST_CONVEX_URL / VITE_TEST_WORKSPACE_ID from
// apps/www/.env.local. Without the query param the env vars are inert, so
// human dev sessions are unaffected.
function readTestBootstrap(): Route | null {
	const params = new URLSearchParams(window.location.search);
	if (params.get("test") !== "1") return null;
	const url = import.meta.env.VITE_TEST_CONVEX_URL;
	const workspaceId = import.meta.env.VITE_TEST_WORKSPACE_ID;
	if (!url || !workspaceId) {
		console.warn(
			"?test=1 set but VITE_TEST_CONVEX_URL / VITE_TEST_WORKSPACE_ID are missing — falling back to normal routing.",
		);
		return null;
	}
	return { kind: "shell", url, workspaceId };
}

export default function App() {
	const [route, setRoute] = useState<Route>(initialRoute);

	const handleDisconnect = () => {
		disconnect();
		setRoute({ kind: "connect" });
	};

	if (route.kind === "connect") {
		return (
			<ConnectScreen
				onConnected={(url) => setRoute({ kind: "open-workspace", url })}
			/>
		);
	}

	if (route.kind === "open-workspace") {
		return (
			<OpenWorkspaceScreen
				url={route.url}
				onSelected={(workspaceId) =>
					setRoute({ kind: "shell", url: route.url, workspaceId })
				}
				onDisconnect={handleDisconnect}
			/>
		);
	}

	return (
		<AppShell
			url={route.url}
			workspaceId={route.workspaceId}
			onSwitch={(id) => {
				setRoute({ kind: "shell", url: route.url, workspaceId: id });
			}}
			onDisconnect={handleDisconnect}
		/>
	);
}
