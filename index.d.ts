// Manual type declaration of file-server for better adoption through typescript
import { IncomingMessage, ServerResponse, RequestListener } from 'http';

interface ServerError {
    code: number,
    message: string;
}

export declare type ErrorCallback = (error: ServerError, request: IncomingMessage, response: ServerResponse) => void;

class FileServer {
    constructor(errorCallback: ErrorCallback, cacheSize?: number);

    serveFile(fileName: string, mimeType?: string, maxAge?: number) : RequestListener;

    serveDirectory(rootDirectory: string, mimeTypes: { [key: string]: string; }, maxAge?: number) : RequestListener;

    close(onClose?: () => void);
}

export = FileServer;