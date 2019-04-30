const rcon = require("rcon");
const util = require("util");
const fs = require('fs');

function runCallbacks(callbackList, data) {
    for (let i = callbackList.length - 1; i >= 0; i--) {
        let cb = callbackList[i];

        // Run callback, if it returns true: temporary callback
        if (cb(data) === true)
            callbackList.splice(i, 1);
    }
}

function log(message) {
    console.log(message);
}


function error(err) {
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

}

function response(res, message) {
    return JSON.stringify({
        error: false,
        message: message,
        response: res
    });
}


function updateServer(connection) {

    let send = (cmd, time, cb) => {
        setTimeout(() => {
            connection.send(time);
            if (util.isFunction(cb)) cb()
        }, time)
    };

    send('say Server update 3 seconds', 1000);
    send('say Server update 2 seconds', 2000);
    send('say Server update 1 seconds', 3000);
    send('sm_reloadadmins', 4000, () => {
        log('Sending ReloadAdmins');
    });
    send('sm plugins reload togsclantags', 5000, () => {
        log('Sending reload TogsClanTags');
    });
    send('sm_reloadccc', 6000, () => {
        log('Sending reload CCC');
    });
    send('say Server update ended.', 7000, () => {
        log('Ended updating');
        connection.disconnect();
        log('Killing connection', 8000);
    });
}


function createRconConnection(ip, port, rcon_password) {
    console.log('Creating connection');
    let connection = new rcon(ip, port, rcon_password);

    connection.on('auth', function () {
        console.log("RCON connected!");
        console.log('Sending update messages:');
        updateServer(connection);

    }).on('response', function (str) {
        console.log(`Receiving response from RCON: ${str}`);

    }).on('end', function (err) {
        console.log(`RCON socket closed! Reason: ${err}`);

    }).on('error', function (err) {
        console.log(`ERROR: ${err} IP="${ip}" PORT="${port}" PASS="${rcon_password}"`);
        console.log('Trying to reopen RCON connection to server');
    });

    connection.connect();

    return connection;
}

function logsRequestPath(req, res, next) {
    log(`Receiving request: ${req.originalUrl}`);

    next();
}

function haltOnTimedout(req, res, next) {
    if (!req.timedout) next();
    if (res.timedout) res.send(error('Timeout'))
}

module.exports.validateToken = function validateToken(tokens) {
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

module.exports.readTokens = function readTokens() {
    let file = fs.readFileSync('tokens.json', {encoding: 'utf8'});

    return JSON.parse(file);
};

module.exports.log = log;
module.exports.error = error;
module.exports.response = response;
module.exports.updateServer = updateServer;
module.exports.runCallbacks = runCallbacks;
module.exports.haltOnTimedout = haltOnTimedout;
module.exports.logsRequestsPath = logsRequestPath;
module.exports.createRconConnection = createRconConnection;
