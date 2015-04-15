var test = require('tape'),
    Fraudster = require('fraudster'),
    path = require('path'),
    kgo = require('kgo'),
    fraudster = new Fraudster(),
    pathToObjectUnderTest ='../',
    testDate = new Date();

fraudster.registerAllowables([pathToObjectUnderTest, 'path']);

function resetMocks(){
    fraudster.registerMock('kgo', kgo);
    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(~fileName.indexOf('.gz'), {
                isFile: function(){return true;},
                mtime: testDate
            });
        }
    });
    fraudster.registerMock('hashr', {
        hash: function(value){
            return value;
        }
    });
    fraudster.registerMock('stream-catcher', function(){
        this.read = function(){};
        this.write = function(){};
    });

    fraudster.registerMock('chokidar', {
        watch: function(){
            return {
                on: function(){}
            };
        }
    });
}

function getCleanTestObject(){
    delete require.cache[require.resolve(pathToObjectUnderTest)];
    fraudster.enable();
    var objectUnderTest = require(pathToObjectUnderTest);
    fraudster.disable();
    resetMocks();
    return objectUnderTest;
}

resetMocks();

test('FileServer is a function', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject();

    t.equal(typeof FileServer, 'function', 'FileServer is a function');
});

test('FileServer requires a callback', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject();

    t.throws(function(){
        new FileServer();
    }, 'FileServer throws if no callback');
});

test('FileServer constructs a cache', function (t) {
    t.plan(4);

    var expectedMax = 1024 * 1000,
        lengthTest = {
            length: 'foo'
        },
        testCache = {};

    fraudster.registerMock('stream-catcher', function(options){
        t.equal(options.max, expectedMax, 'cache max set correctly');
        t.equal(typeof options.length, 'function', 'length is a function');
        t.equal(options.length(lengthTest), 'foo', 'length function gets length property');
        return testCache;
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.equal(fileServer._cache, testCache, 'cache was set');
});

test('FileServer constructs a cache with custom size', function (t) {
    t.plan(1);

    var expectedMax = 123;

    fraudster.registerMock('stream-catcher', function(options){
        t.equal(options.max, expectedMax, 'cache max set correctly');
    });

    var FileServer = getCleanTestObject();

    new FileServer(function(){}, expectedMax);
});

test('FileServer sets and flips the error callback', function (t) {
    t.plan(3);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(error, request, response){
            t.equal(error, 3, 'error is correct');
            t.equal(request, 1, 'request is correct');
            t.equal(response, 2, 'response is correct');
        });

    fileServer._errorCallback(1,2,3);
});

test('serveFile is a function', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.equal(typeof fileServer.serveFile, 'function', 'serveFile is a function');
});

test('serveFile requires a fileName', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.throws(
        function(){
            fileServer.serveFile();
        },
        'serveFile throws if no fileName'
    );
});

test('serveFile returns a function', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.equal(typeof fileServer.serveFile('./foo'), 'function', 'serveFile returns a function');
});

test('serveFile returns full error on generic stats error', function (t) {
    t.plan(3);

    var testFileName = './foo.txt',
        testRequest = {},
        testResponse = {},
        expectedError = 'BANG';

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(expectedError);
        }
    });

    function errorCallback(error, request, response){
        t.deepEqual(error, expectedError, 'got correct error');
        t.equal(request, testRequest, 'got request');
        t.equal(response, testResponse, 'got response');
    }

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(errorCallback),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile 404s on file stat ENOENT error', function (t) {
    t.plan(3);

    var testFileName = './foo.txt',
        testRequest = {},
        testResponse = {},
        expectedError = {
            code: 404,
            message: '404: Not Found ' + testFileName
        };

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback({message: 'ENOENT'});
        }
    });

    function errorCallback(error, request, response){
        t.deepEqual(error, expectedError, 'got correct error');
        t.equal(request, testRequest, 'got request');
        t.equal(response, testResponse, 'got response');
    }

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(errorCallback),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile 404s on not isFile', function (t) {
    t.plan(3);

    var testFileName = './foo.txt',
        testRequest = {},
        testResponse = {
            setHeader: function(){}
        },
        expectedError = {
            code: 404,
            message: '404: Not Found ' + testFileName
        };

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(~fileName.indexOf('.gz'), {
                isFile: function(){return false;}
            });
        }
    });

    function errorCallback(error, request, response){
        t.deepEqual(error, expectedError, 'got correct error');
        t.equal(request, testRequest, 'got request');
        t.equal(response, testResponse, 'got response');
    }

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(errorCallback),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile sets headers and asks for file', function (t) {
    t.plan(10);

    var testFileName = './foo.txt',
        testMimeType = 'bar',
        testMaxAge = 123,
        testError = 'BOOM!',
        testRequest = {},
        testResponse = {
            setHeader: function(key, value){
                if(key === 'ETag'){
                    t.equal(value, testFileName + testDate.getTime(), 'got correct header value for ' + key);
                    return;
                }

                if(key === 'Cache-Control'){
                    t.equal(value, 'private, max-age=' + testMaxAge, 'got correct header value for ' + key);
                    return;
                }

                if(key === 'Content-Type'){
                    t.equal(value, testMimeType, 'got correct header value for ' + key);
                    return;
                }

                t.fail('Set unexpected header key: ' + key + ' value: ' + value);
            },
            on: function(eventName, callback){
                t.equal(eventName, 'error', 'set error handeler');
                callback(testError);
            }
        };

    fraudster.registerMock('stream-catcher', function(){
        this.write = function(fileName, response, createReadStream){
            t.equal(fileName, testFileName, 'fileName is correct');
            t.equal(response, testResponse, 'response is correct');
            t.equal(typeof createReadStream, 'function', 'createReadStream is a function');
        };
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(error, request, response){
            t.equal(error, testError, 'error is correct');
            t.equal(request, testRequest, 'request is correct');
            t.equal(response, testResponse, 'response is correct');
        }),
        serveFile = fileServer.serveFile(testFileName, testMimeType, testMaxAge);

    serveFile(testRequest, testResponse);
});

test('serveFile returns 304 if etag matches', function (t) {
    t.plan(4);

    var testFileName = './foo.txt',
        testRequest = {
            headers: {
                'if-none-match': testFileName + testDate.getTime()
            }
        },
        testResponse = {
            setHeader: function(key, value){
                if(key === 'ETag'){
                    t.equal(value, testFileName + testDate.getTime(), 'got correct header value for ' + key);
                    return;
                }

                if(key === 'Cache-Control'){
                    t.equal(value, 'private, max-age=0', 'got correct header value for ' + key);
                    return;
                }

                t.fail('Set unexpected header key: ' + key + ' value: ' + value);
            },
            writeHead: function(code){
                t.equal(code, 304, 'set 304 code correctly');
            },
            end: function(){
                t.pass('end was called');
            }
        };

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){}),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile passes create stream into cache', function (t) {
    t.plan(10);

    var testFileName = './foo.txt',
        testKey = 'bar',
        testError = 'BANG!!!!',
        testReadStream = {
            on: function(eventName, callback){
                t.equal(eventName, 'error', 'set error handeler');
                callback(testError);
            }
        },
        testRequest = {},
        testResponse = {
            setHeader: function(){},
            removeHeader: function(){},
            on: function(){}
        };

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(~fileName.indexOf('.gz'), {
                isFile: function(){return true;},
                mtime: testDate
            });
        },
        createReadStream: function(key){
            t.equal(key, testKey, 'key is correct');
            return testReadStream;
        }
    });

    fraudster.registerMock('stream-catcher', function(){
        this.write = function(fileName, response, createReadStream){
            t.equal(fileName, testFileName, 'fileName is correct');
            t.equal(response, testResponse, 'response is correct');
            t.equal(typeof createReadStream, 'function', 'createReadStream is a function');

            createReadStream(testKey);
        };

        this.read = function(key, readStream){
            t.equal(key, testKey, 'key is correct');
            t.equal(readStream, testReadStream, 'readStream is correct');
        };
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(error, request, response){
            t.equal(error, testError, 'error is correct');
            t.equal(request, testRequest, 'request is correct');
            t.equal(response, testResponse, 'response is correct');
        }),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile watches files only once with chokidar', function (t) {
    t.plan(4);

    var testFileName = './foo.txt',
        expectedOptions = {persistent: true, ignoreInitial: true};

    fraudster.registerMock('chokidar', {
        watch: function(fileName, options){
            t.equal(fileName, testFileName, 'got correct fileName');
            t.deepEqual(options, expectedOptions, 'got correct options');

            return {
                on: function(event, callback){
                    t.equal(event, 'change', 'got correct event');
                    callback();
                }
            };
        }
    });

    fraudster.registerMock('stream-catcher', function(){
        this.del = function(fileName){
            t.equal(fileName, testFileName, 'deleted correct fileName');
        };
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    fileServer.serveFile(testFileName);
    fileServer.serveFile(testFileName);
});

test('process on exit cleans up watches', function (t) {
    t.plan(1);

    var testFileName = './foo.txt',
        oldProcessOn = process.on,
        FileServer;

    process.on = function(event, callback){
        setTimeout(function(){
            var fileServer = new FileServer(function(){});

            fileServer.serveFile(testFileName);

            callback();

            oldProcessOn.call(process, event, callback);
        }, 0);

        process.on = oldProcessOn;
    };

    fraudster.registerMock('chokidar', {
        watch: function(){
            return {
                on: function(event, callback){
                    callback();
                },
                close: function(){
                    t.pass('closed watcher');
                }
            };
        }
    });

    fraudster.registerMock('stream-catcher', function(){
        this.del = function(){};
    });

    FileServer = getCleanTestObject();
});

test('serveFile checks for .gz file if gzip supported but uses original if not available', function (t) {
    t.plan(3);

    var testFileName = './foo.txt',
        testRequest = {
            headers: {
                'accept-encoding': 'foo gzip bar'
            }
        },
        testResponse = {
            setHeader: function(){},
            removeHeader: function(){},
            on: function(){}
        };

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(~fileName.indexOf('.gz'), {
                isFile: function(){return true;},
                mtime: testDate
            });
        },
        createReadStream: function(){}
    });

    fraudster.registerMock('stream-catcher', function(){
        this.write = function(fileName, response, createReadStream){
            t.equal(fileName, testFileName, 'fileName is correct');
            t.equal(response, testResponse, 'response is correct');
            t.equal(typeof createReadStream, 'function', 'createReadStream is a function');
        };
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){}),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveFile uses .gz file if gzip supported and exists', function (t) {
    t.plan(3);

    var testFileName = './foo.txt',
        testRequest = {
            headers: {
                'accept-encoding': 'foo gzip bar'
            }
        },
        testResponse = {
            setHeader: function(){},
            removeHeader: function(){},
            on: function(){}
        };

    fraudster.registerMock('graceful-fs', {
        stat: function(fileName, callback){
            callback(!~fileName.indexOf('.gz'), {
                isFile: function(){return true;},
                mtime: testDate
            });
        },
        createReadStream: function(){}
    });

    fraudster.registerMock('stream-catcher', function(){
        this.write = function(fileName, response, createReadStream){
            t.equal(fileName, testFileName + '.gz', 'fileName is correct');
            t.equal(response, testResponse, 'response is correct');
            t.equal(typeof createReadStream, 'function', 'createReadStream is a function');
        };
    });

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){}),
        serveFile = fileServer.serveFile(testFileName);

    serveFile(testRequest, testResponse);
});

test('serveDirectory is a function', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.equal(typeof fileServer.serveDirectory, 'function', 'serveDirectory is a function');
});

test('serveDirectory requires a rootDirectory', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.throws(
        function(){
            fileServer.serveDirectory();
        },
        'serveDirectory throws if no rootDirectory'
    );
});

test('serveDirectory requires a mimeTypes object', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.throws(
        function(){
            fileServer.serveDirectory('./files');
        },
        'serveDirectory throws if no mimeTypes'
    );
});

test('serveDirectory mimeTypes must start with a .', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.throws(
        function(){
            fileServer.serveDirectory(
                './files',
                {
                    '.foo': 'bar',
                    'meh': 'stuff'
                },
                123
            );
        },
        'serveDirectory throws if no mimeTypes'
    );
});

test('serveDirectory returns a function', function (t) {
    t.plan(1);

    var FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){});

    t.equal(typeof fileServer.serveDirectory('./files', {}), 'function', 'serveDirectory returns a function');
});

test('serveDirectory 404s if mimetype mismatch', function (t) {
    t.plan(3);

    var testRequest = {},
        testResponse = {},
        testRootDirectory = './files',
        testFile = './foo.bar',
        expectedError = {code: 404, message: '404: Not Found ' + path.join(testRootDirectory, testFile)},
        FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(error, request, response){
            t.deepEqual(error, expectedError, 'error is correct');
            t.equal(request, testRequest, 'request is correct');
            t.equal(response, testResponse, 'response is correct');
        }),
        serveDirectory = fileServer.serveDirectory(
            testRootDirectory,
            {
                '.txt': 'text/plain'
            }
        );

    serveDirectory(testRequest, testResponse, testFile);
});

test('serveDirectory 404s if try to navigate up a level', function (t) {
    t.plan(3);

    var testRequest = {},
        testResponse = {},
        testRootDirectory = './files',
        testFile = '../../foo.txt',
        expectedError = {code: 404, message: '404: Not Found ' + testFile},
        FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(error, request, response){
            t.deepEqual(error, expectedError, 'error is correct');
            t.equal(request, testRequest, 'request is correct');
            t.equal(response, testResponse, 'response is correct');
        }),
        serveDirectory = fileServer.serveDirectory(
            testRootDirectory,
            {
                '.txt': 'text/plain'
            }
        );

    serveDirectory(testRequest, testResponse, testFile);
});

test('serveDirectory calls serveFile', function (t) {
    t.plan(5);

    var testRequest = {},
        testResponse = {},
        testRootDirectory = './files',
        testFile = './bar/foo.txt',
        testMaxAge = 123,
        FileServer = getCleanTestObject(),
        fileServer = new FileServer(function(){}),
        serveDirectory = fileServer.serveDirectory(
            testRootDirectory,
            {
                '.txt': 'text/majigger'
            },
            testMaxAge
        );

    fileServer.serveFile = function(fileName, mimeType, maxAge){
        t.equal(fileName, path.join(testRootDirectory, testFile), 'fileName is correct');
        t.equal(mimeType, 'text/majigger', 'mimeType is correct');
        t.equal(maxAge, testMaxAge, 'maxAge is correct');

        return function(request, response){
            t.equal(request, testRequest, 'request is correct');
            t.equal(response, testResponse, 'response is correct');
        };
    };

    serveDirectory(testRequest, testResponse, testFile);
});