import fs from "fs";

export const runCallbacks = (callbackList, data) => {
    for (let i = callbackList.length - 1; i >= 0; i--) {
        let cb = callbackList[i];

        // Run callback, if it returns true: temporary callback
        if (cb(data) === true)
            callbackList.splice(i, 1);
    }
};

export const log = (message) => {
    let now = (new Date()).toISOString();
    console.log(`[${now}]: ${message}`);
};

export const error = (err) => {
    let message;

    if (err.cause) {
        message = err.cause
    } else if (err.message) {
        message = err.message;
    } else {
        message = 'No error message.';
    }

    return JSON.stringify({
        error: true,
        message: message,
        raw: err,
    });
};

export const response = (res, message) => {
    return JSON.stringify({
        error: false,
        message: message,
        response: res
    });
};

export const logsRequestPath = (req, res, next) => {
    log(`Receiving request: ${req.originalUrl}`);

    next();
};

export const haltOnTimeout = (req, res, next) => {
    if (!req.timedout) next();
    if (res.timedout) res.send(error('Timeout'))
};

export const validateToken = (tokens) => {
    return (req, res, next) => {
        let token = req.query.token;

        // Check if token is present in query
        if (!token) {
            res.send(error(new Error('Please provide authentication token.')));
        }

        // Check if token is inside token list
        if (tokens.indexOf(token) === -1) {
            res.send(error(new Error(`Invalid token: ${token}`)));
        } else {
            next();
        }
    }
};

export const readTokens = () => {
    let file = fs.readFileSync('tokens.json', {encoding: 'utf8'});
    return JSON.parse(file);
};