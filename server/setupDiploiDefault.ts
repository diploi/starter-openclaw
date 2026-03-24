import path from "path";
import { fileURLToPath } from 'node:url';
import ensureDir from "./utils/ensureDir.ts";
import { gatewaySettings } from "./constants.ts";
import fs from 'node:fs';
const { workspacePath } = gatewaySettings;

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(serverDir, 'utils');

export const setupDiploiDefault = () => {
    try {
        // Create a new directory under workspace/skills/hello-diploi
        const skillFilePath = path.join(workspacePath, 'skills', 'hello-diploi', 'SKILL.md');
        const identityFile = path.join(workspacePath, 'IDENTITY.md');

        ensureDir(skillFilePath);
        ensureDir(identityFile);

        fs.copyFileSync(path.join(templateDir, 'diploiSkill.md'), skillFilePath);
        fs.copyFileSync(path.join(templateDir, 'diploiIdentity.md'), identityFile);
    } catch (error) {
        throw new Error(`Failed to set up default Diploi files: ${error instanceof Error ? error.message : String(error)}`);
    }
}

