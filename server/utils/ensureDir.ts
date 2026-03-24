import fs from 'node:fs';
import path from 'node:path';

const ensureDir = (filePath: string) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
};

export default ensureDir;