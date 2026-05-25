// tools/update-notes.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import type { AutoresearchRuntime } from "../types";
import type { AutoresearchStorage } from "../storage";

export function createUpdateNotesTool({
	storage,
	runtime,
	directory,
}: {
	storage: AutoresearchStorage;
	runtime: AutoresearchRuntime;
	directory: string;
}) {
	return tool({
		description: "Update the experiment notes or append a new idea",
		args: {
			body: z
				.string()
				.optional()
				.describe("Replace the entire notes with this content"),
			append_idea: z
				.string()
				.optional()
				.describe("Append this as a new bullet point to the ideas section"),
		},
		execute: async (args) => {
			const session = storage.getActiveSession();
			if (!session) {
				return {
					title: "update_notes",
					output: "No active experiment session. Call init_experiment first.",
					metadata: { error: "no_session" },
				};
			}

			let newNotes = session.notes;

			if (args.body !== undefined) {
				newNotes = args.body;
			}

			if (args.append_idea) {
				const ideaLine = `- ${args.append_idea}`;
				if (newNotes.length > 0) {
					newNotes += "\n" + ideaLine;
				} else {
					newNotes = ideaLine;
				}
			}

			storage.updateNotes(session.id, newNotes);

			// Update runtime state
			runtime.state.notes = newNotes;

			// Update autoresearch.md
			const mdPath = path.join(directory, "autoresearch.md");
			if (fs.existsSync(mdPath)) {
				let content = fs.readFileSync(mdPath, "utf-8");
				const notesMatch = content.match(/## Notes\n([\s\S]*?)(?=\n## Runs|$)/);
				if (notesMatch) {
					content = content.replace(
						notesMatch[0],
						`## Notes\n${newNotes}`,
					);
					fs.writeFileSync(mdPath, content, "utf-8");
				}
			}

			return {
				title: "update_notes",
				output: `Notes updated.\n\n${newNotes}`,
				metadata: { notes: newNotes },
			};
		},
	});
}
