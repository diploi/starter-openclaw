import path from "path";
import ensureDir from "./utils/ensureDir.ts";
import { gatewaySettings } from "./constants.ts";
import fs from 'node:fs';
const { workspacePath } = gatewaySettings;

export const setupSkills = () => {
    try {
        // Create a new directory under workspace/skills/hello-diploi
        const skillDir = path.join(workspacePath, 'skills', 'hello-diploi');

        ensureDir(skillDir);

        // create a new file called SKILL.md in that directory with the sample basic content
        const skillFilePath = path.join(skillDir, 'SKILL.md');
        const skillContent = `
            ---
            name: hello-diploi
            description: A simple skill that says hello from Diploi.
            ---
    
            # Hello Diploi Skill
    
            When the user asks for a greeting, use the \`echo\` tool to say
            "Hello from Diploi!". 
        `

        fs.writeFileSync(skillFilePath, skillContent, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
        throw new Error(`Failed to set up skills: ${error instanceof Error ? error.message : String(error)}`);
    }
}

