#!/usr/bin/env node
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

const contentTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.webp': 'image/webp'
};

function resolveRequestPath(url) {
    const pathname = decodeURIComponent(new URL(url, `http://${host}:${port}`).pathname);
    const relativePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    const filePath = resolve(rootDir, `.${relativePath}`);
    if (!filePath.startsWith(rootDir + sep) && filePath !== rootDir) {
        return null;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        return join(filePath, 'index.html');
    }
    return filePath;
}

const server = createServer((request, response) => {
    const filePath = resolveRequestPath(request.url || '/');
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
    }

    response.writeHead(200, {
        'content-type': contentTypes[extname(filePath)] || 'application/octet-stream'
    });
    createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
    console.log(`Serving ${rootDir} at http://${host}:${port}/`);
});
