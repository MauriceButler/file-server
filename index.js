const fs = require('graceful-fs');
const path = require('path');
const hashr = require('hashr');
const kgo = require('kgo');
const StreamCatcher = require('stream-catcher');
const chokidar = require('chokidar');

const watchers = {};
const cacheMaxSize = 1024 * 1000;

function cacheLengthFunction(n) {
    return n.length;
}

function createReadStream(fileServer, request, response) {
    return function(key) {
        const readStream = fs.createReadStream(key);

        readStream.on('error', fileServer.errorCallback.bind(null, request, response));

        fileServer.cache.read(key, readStream);
    };
}

function FileServer(errorCallback, cacheSize) {
    if (!errorCallback) {
        throw new Error('Must supply an error callback to File Server');
    }

    this.cache = new StreamCatcher({
        length: cacheLengthFunction,
        max: cacheSize == null ? cacheMaxSize : cacheSize,
    });

    this.errorCallback = function(request, response, error) {
        errorCallback(error, request, response);
    };

    // Local watchers for programmatic closing
    this.watchers = {};
}

FileServer.prototype.getFile = function(stats, fileName, mimeType, maxAge, request, response) {
    const fileServer = this;

    if (!stats.isFile()) {
        return fileServer.errorCallback(request, response, { code: 404, message: `404: Not Found ${fileName}` });
    }

    const eTag = hashr.hash(fileName + stats.mtime.getTime());

    response.setHeader('ETag', eTag);
    response.setHeader('Cache-Control', `private, max-age=${maxAge}`);

    if (request.headers && request.headers['if-none-match'] === eTag) {
        response.writeHead(304);
        return response.end();
    }

    response.setHeader('Content-Type', mimeType);

    response.on('error', fileServer.errorCallback.bind(null, request, response));

    if (stats.size === 0) {
        return response.end();
    }

    fileServer.cache.write(fileName, response, createReadStream(fileServer, request, response));
};

function getStats(acceptsGzip, fileName, response, done) {
    const gzipFileName = `${fileName}.gz`;

    if (acceptsGzip) {
        fs.stat(gzipFileName, (error, stats) => {
            if (error) {
                return fs.stat(fileName, (error, stats) => {
                    done.call(null, error, stats, fileName);
                });
            }

            response.setHeader('Content-Encoding', 'gzip');
            done(null, stats, gzipFileName);
        });
        return;
    }

    fs.stat(fileName, (error, stats) => {
        done.call(null, error, stats, fileName);
    });
}

FileServer.prototype.serveFile = function(fileName, mimeType = 'text/plain', maxAge = 0) {
    const fileServer = this;

    if (!watchers[fileName]) {
        const watcher = chokidar.watch(fileName, { persistent: true, ignoreInitial: true });
        watcher.on('change', () => {
            fileServer.cache.del(fileName);
        });
        watchers[fileName] = watcher;
        // Add to local instance for programmtic closing
        this.watchers[fileName] = watcher;
    }

    if (!fileName || typeof fileName !== 'string') {
        throw new Error('Must provide a fileName to serveFile');
    }

    return function(request, response) {
        const acceptsGzip =
            request.headers &&
            request.headers['accept-encoding'] &&
            ~request.headers['accept-encoding'].indexOf('gzip');

        kgo({
            acceptsGzip,
            fileName,
            mimeType,
            maxAge,
            request,
            response,
        })
        ('stats', 'finalFilename', ['acceptsGzip', 'fileName', 'response'], getStats)
        (['stats', 'finalFilename', 'mimeType', 'maxAge', 'request', 'response'], fileServer.getFile.bind(fileServer))
        (['*'], error => {
            if (error.message && ~error.message.indexOf('ENOENT')) {
                return fileServer.errorCallback(request, response, {
                    code: 404,
                    message: `404: Not Found ${fileName}`,
                });
            }

            return fileServer.errorCallback(request, response, error);
        });
    };
};

FileServer.prototype.serveDirectory = function(rootDirectory, mimeTypes, maxAge = 0) {
    const fileServer = this;

    if (!rootDirectory || typeof rootDirectory !== 'string') {
        throw new Error('Must provide a rootDirectory to serveDirectory');
    }

    if (!mimeTypes || typeof mimeTypes !== 'object') {
        throw new Error('Must provide a mimeTypes object to serveDirectory');
    }

    const keys = Object.keys(mimeTypes);

    for (let i = 0; i < keys.length; i++) {
        if (keys[i].charAt(0) !== '.') {
            throw new Error(`Extension found without a leading periond ("."): ${keys[i]}`);
        }
    }

    return function(request, response, fileName) {
        if (arguments.length < 3) {
            fileName = request.url.slice(1);
        } 

        const filePath = path.join(rootDirectory, fileName);

        const extention = path.extname(filePath).toLowerCase();

        if (!mimeTypes[extention]) {
            return fileServer.errorCallback(request, response, { code: 404, message: `404: Not Found ${filePath}` });
        }

        if (~path.relative(rootDirectory, filePath).indexOf('..')) {
            return fileServer.errorCallback(request, response, { code: 404, message: `404: Not Found ${fileName}` });
        }

        fileServer.serveFile(filePath, mimeTypes[extention], maxAge)(request, response);
    };
};

FileServer.prototype.close = function(onClose) {
    const closePromises = [];
    Object.keys(this.watchers).forEach((key) => {
        const watcher = this.watchers[key];
        closePromises.push(watcher.close());
        delete this.watchers[key];
    });
    
    Promise.all(closePromises).then(() => {
        onClose();
    });
}

process.on('exit', () => {
    Object.values(watchers).forEach(watcher => watcher.close());
});

module.exports = FileServer;
