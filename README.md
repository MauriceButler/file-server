# file-server

Simple http file server that supports files and directories

## Example

```javascript
const FileServer = require('file-server');

const fileServer = new FileServer((error, request, response) => {
    response.statusCode = error.code || 500;
    response.end(error);
});

const serveRobots = fileServer.serveFile('./robots.txt', 'text/plain');

require('http')
    .createServer(serveRobots)
    .listen(8080);
```

### new FileServer(errorCallback, [cacheSize])

The FileServer constructor takes 2 arguments `errorCallback` and an optional `cacheSize` (bytes).

The callback gets 3 arguments `(error, request, response)`

`cacheSize` defaults to 1024 \* 1000

If the error argument was the result of a missing file the error will have a `code` of 404. Other codes may be added in the future.

```javascript
const FileServer = require('file-server');

const fileServer = new FileServer((error, request, response) => {
    response.statusCode = error.code || 500;
    response.end(error);
});
```

### fileServer.serveFile(fileName, mimeType, [maxAge])

The `serveFile` method takes 3 arguments `fileName`, `mimeType` and an optional `maxAge`.

`fileName` is the name of the file to serve.

`mimeType` is a string, defining which mime type should be used.

`maxAge` will defaults to 0 (rely on ETags)

This will return a function that takes a `request` and a `response` and will stream the file to the response, or in the case of an error, call the error callback passed in at construction.

```javascript
const serveRobots = fileServer.serveFile('./robots.txt', 'text/plain');

serveRobots(request, response);
```

### fileServer.serveDirectory(rootDirectory, mimeTypes, [maxAge])

The `serveDirectory` method takes 3 arguments `rootDirectory`, `mimeTypes` and an optional `maxAge`.

`rootDirectory` is the base directory to serve files from. If a file above this directory is asked for the request will error with a 404.

`mimeTypes` is an object keyed by extension, defining which mime type should be used for the extension. If a file is asked for with an extension that is not defined the request will error with a 404.

`maxAge` will defaults to 0 (rely on ETags)

This will return a function that takes a `request`, `response` and a `filename` and will stream the file to the response, or in the case of an error, call the error callback passed in at construction.

```javascript
const serveImagesDirectory = fileServer.serveDirectory('./images', {
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
});

serveImagesDirectory(request, response, request.url);
```

If the `fileName` argument is ommited, the filename will be automatically pulled from `request.url`
```javascript
serveImagesDirectory(request, response);
```

### Closing connections

File server automically closes any watchers on files or directories during process end.  If you have a need for stopping and starting
tha file server throughout a process (i.e. using jest), you may also programmatically close all open file watchers on the server 'close' event.

```javascript

const fileServer = new FileServer((error, request, response) => {
    response.statusCode = error.code || 500;
    response.end(error);
});

// Your file serving setup

require('http')
    .createServer(fileServer.serveDirectory('./images', {
        '.gif': 'image/gif',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
    }))
    .listen(8080)
    .on('close', () => {
        fileServer.close(() => {
            console.log('We have closed all file server connections');
        });
    });
```