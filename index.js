var fs = require('graceful-fs'),
    path = require('path'),
    hashr = require('hashr'),
    StreamCatcher = require('stream-catcher'),
    cacheMaxSize = 1024 * 1000;

function cacheLengthFunction(n) {
    return n.length;
}

function createReadStream(fileServer, request, response){
    return function(key){
        var readStream = fs.createReadStream(key);

        readStream.on('error', fileServer._errorCallback.bind(null, request, response));

        fileServer._cache.read(key, readStream);
    };
}

function FileServer(errorCallback, cacheSize){
    if(!errorCallback){
        throw 'Must supply an error callback to File Server';
    }

    this._cache = new StreamCatcher({
        length: cacheLengthFunction,
        max: cacheSize == null ? cacheMaxSize : cacheSize
    });

    this._errorCallback = function(request, response, error){
        errorCallback(error, request, response);
    };
}

FileServer.prototype.serveFile = function(fileName, mimeType, maxAge){
    var fileServer = this;

    if(!fileName || typeof fileName !== 'string'){
        throw 'Must provide a fileName to serveFile';
    }

    if(!mimeType){
        mimeType = 'text/plain';
    }

    if(maxAge == null){
        maxAge = 0;
    }

    return function(request, response){
        fs.stat(fileName, function(error, stats){
            if(error){
                if(error.message && ~error.message.indexOf('ENOENT')){
                    return fileServer._errorCallback(request, response, {code: 404, message: '404: Not Found ' + fileName});
                }

                return fileServer._errorCallback(request, response, error);
            }

            if(!stats.isFile()){
                return fileServer._errorCallback(request, response, {code: 404, message: '404: Not Found ' + fileName});
            }

            var eTag = hashr.hash(fileName + stats.mtime.getTime());

            response.setHeader('ETag', eTag);
            response.setHeader('Cache-Control', 'private, max-age=' + maxAge);

            response.removeHeader('Set-Cookie');

            if(request.headers && request.headers['if-none-match'] === eTag) {
                response.writeHead(304);
                return response.end();
            }

            response.setHeader('Content-Type', mimeType);

            response.on('error', fileServer._errorCallback.bind(null, request, response));

            fileServer._cache.write(fileName, response, createReadStream(fileServer, request, response));
        });
    };
};

FileServer.prototype.serveDirectory = function(rootDirectory, mimeTypes, maxAge){
    var fileServer = this;

    if(!rootDirectory || typeof rootDirectory !== 'string'){
        throw 'Must provide a rootDirectory to serveDirectory';
    }

    if(!mimeTypes || typeof mimeTypes !== 'object'){
        throw 'Must provide a mimeTypes object to serveDirectory';
    }

    if(maxAge == null){
        maxAge = 0;
    }

    var keys = Object.keys(mimeTypes);

    for (var i = 0; i < keys.length; i++) {
        if(keys[i].charAt(0) !== '.') {
                throw 'Extension found without a leading periond ("."): ' + keys[i];
            }
    }

    return function(request, response, fileName){
        var filePath = path.join(rootDirectory, fileName),
            extention = path.extname(filePath).toLowerCase();

        if(!mimeTypes[extention]){
            return fileServer._errorCallback(request, response, {code: 404, message: '404: Not Found ' + filePath});
        }

        if(~path.relative(rootDirectory, filePath).indexOf('..')) {
            return fileServer._errorCallback(request, response, {code: 404, message: '404: Not Found ' + fileName});
        }

        fileServer.serveFile(filePath, mimeTypes[extention], maxAge)(request, response);
    };
};

module.exports = FileServer;