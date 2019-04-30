const request = require('request');
const fs = require('fs');
const express = require('express');
const util = require('util');
const app = express();
const timeout = require('connect-timeout');
const bodyParser = require("body-parser");
const dotenv = require('dotenv').config({path: __dirname + '/.env'});
const cors = require('cors');
const SteamUser = require('steam-user');
const TradeOfferManager = require('steam-tradeoffer-manager');
const SteamCommunity = require('steamcommunity');
const SteamID = SteamCommunity.SteamID;
const log = require('./helpers').log;
const response = require("./helpers").response;
const errorResponse = require("./helpers").error;
const readTokens = require("./helpers").readTokens;
const validateToken = require("./helpers").validateToken;
const haltOnTimedout = require('./helpers').haltOnTimedout;
const logsRequestsPath = require('./helpers').logsRequestsPath;
const createRconConnection = require("./helpers").createRconConnection;
const Sentry = require('@sentry/node');
const winston = require('winston');
const {Loggly} = require('winston-loggly-bulk');

/**************
 * MIDDLEWARE *
 **************/

app.use(validateToken(readTokens()));
app.use(logsRequestsPath);
app.use(timeout(30000));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cors());
app.use(haltOnTimedout);

/*********
 * SETUP *
 *********/

Sentry.init({dsn: process.env.SENTRY_DSN});

/*******************
 *    CONSTANTS    *
 *******************/

const HTTP_PORT = process.env.HTTP_PORT || 8888;
const DATE_NOW = Date.now();
const LOGS_PATH = __dirname + `/logs/logs${DATE_NOW}.log`;
const STDOUT_PATH = __dirname + `/logs/stdout${DATE_NOW}.log`;
const STDERR_PATH = __dirname + `/logs/errout${DATE_NOW}.log`;

/*********************
 *    WEB LOGGING    *
 *********************/

let log_file = fs.createWriteStream(LOGS_PATH, {flags: 'w'});
let out_file = fs.createWriteStream(STDOUT_PATH);
let err_file = fs.createWriteStream(STDERR_PATH);

let stdout = process.stdout.write.bind(process.stdout);
let stderr = process.stderr.write.bind(process.stderr);

process.stdout.write = out_file.write.bind(out_file);
process.stderr.write = err_file.write.bind(err_file);

console.log = function (d) {
    stdout(util.format(d) + '\n');

    log_file.write(util.format(d) + '\n');
    out_file.write(util.format(d) + '\n');

    winston.log('info', d);
};

process.on('uncaughtException', function (err) {
    console.error((err && err.stack) ? err.stack : err);
});

/*******************
 *    VARIABLES    *
 *******************/

let lastLoginAttempt = 0;
let logged = false;

let client = new SteamUser({enablePicsCache: true});
let community = new SteamCommunity();
let manager = new TradeOfferManager({
    'steam': client,
    'community': community,
    'domain': 'localhost',
    'language': 'en'
});

// Restore PollData
if (fs.existsSync(__dirname + '/polldata.json')) {
    manager.pollData = JSON.parse(fs.readFileSync(__dirname + '/polldata.json'));
}

client.on('loggedOn', function (det) {
    log("Logged on");

    setInterval(function () {
        log('Automatic session refresher called');

        client.webLogOn();
    }, 1000 * 60 * 10);
});

client.on('error', function (err) {
    console.error('############################# STARTED LOGGGING ERROR NOW #############################');

    console.error('console.error(err): ');
    console.error(err);

    console.error('console.error(err.cause): ');
    console.error(err.cause);

    console.error('console.error(err.eresult): ');
    console.error(err.eresult);

    console.error('console.error(err.strError): ');
    console.error(err.strError);

    console.error('############################# ENDED LOGGGING ERROR NOW #############################');
});

client.on('disconnected', function (eresult, msg) {
    log(`Disconnect from Steam: ${msg} -- EResult[${eresult}]`);
    logged = false;
});

/**
 * @deprecated - this is not used and spams alot of messages
 */
client.on('debug', function (eresult, msg) {
    log(`DEBUG ${eresult}: ${msg}`);
});

client.on('webSession', function (sessionID, cookies) {
    log("Got web session");
    community.setCookies(cookies);
    manager.setCookies(cookies, function (err) {
        if (err) {
            log(`Failed to retrive account cookies ${err}`);
            process.exit(1); // Fatal error since we couldn't get our API key
            return;
        }

        logged = true;
        log(`Got API key: ${manager.apiKey}`);
        log(`Got cookies: ${cookies}`);
    });
});


community.on("sessionExpired", function (err) {
    if (err) log(`Community triggered sessionExpired: ${err}`);

    log('Community triggered sessionExpired, trying to relogging');

    community.loggedIn(function (err, loggedIn, familyView) {
        if (err) log(`community.loggedIn returned error: ${err}`);

        log(`community.loggedIn: ${loggedIn}`);
    });

    let delta = Date.now() - lastLoginAttempt;

    if (delta > 10000) {
        log("Session Expired, relogging.");

        lastLoginAttempt = Date.now();
        client.webLogOn();
    } else {
        log(`Session Expired, waiting ${delta}ms a while before attempting to relogin.`);

        setTimeout(() => {
            client.webLogOn();
        }, delta)
    }
});

// Hook PollData to save on change
manager.on('pollData', function (pollData) {
    fs.writeFile('polldata.json', JSON.stringify(pollData));
});

/***************
 *    PAGES    *
 ***************/

/**
 * Attempts to login using account information
 */
app.get('/login', (req, res) => {
    let code = req.query.code;

    client.logOn({
        accountName: process.env.ACCOUNT_NAME,
        password: process.env.ACCOUNT_PASS,
        twoFactorCode: code
    });

    log('Trying to log in to Steam with two factor code.');
    res.send(response('Trying to login...'));
});

/**
 * Logs an internal message
 */
app.get('/consoleLog', (req, res) => {
    log(req.query.message);
    res.send(response('Logged'));
});

/**
 * Retrieves user inventory
 */
app.get('/inventory', (req, res) => {
    let steamid = req.query.steamid;
    manager.getUserInventoryContents(new SteamID(steamid), 730, 2, true, function (err, inventory) {
        if (err) {
            log(`Error getting inventory from SteamID: ${steamid}`);
            res.send(errorResponse(err));
        } else {
            log(`Sucessfully returned inventory from SteamID: ${steamid}`);
            res.send(response(inventory));
        }
    });
});

/**
 * @deprecated
 */
app.post('/csgoServerUpdate', (req, res) => {
    let ip = req.body.ip;
    let port = req.body.port;
    let password = req.body.password;

    createRconConnection(ip, port, password);

    res.send(response(`Server update queued for: ip=${ip} ${port} port=${port} pass=${pass}: password=${password}`));
});

/**
 * Daemon status
 */
app.get('/status', (req, res) => {
    res.send(response({
        online: true,
        logged: logged
    }));
});

/**
 * Converts any Steam64 IDs to Steam2
 *
 * @deprecated - this should be replaced by a PHP library
 */
app.get('/steam2', (req, res) => {
    let steamid = req.query.steamid;
    let steamObject = new SteamID(steamid);

    res.send(response(steamObject.getSteam2RenderedID()));
});

/**
 * Get trade offer information by ID
 */
app.get('/getTradeOffer', (req, res) => {
    let offer_id = req.query.offerid;

    manager.getOffer(offer_id, (err, offer) => {
        if (err) {
            log('Error getting offer #' + offer_id);
            res.send(errorResponse(err));
        } else {
            log('Sucessfully returned offer #' + offer_id);
            res.send(response(offer));
        }
    });
});

/**
 * Cancels trade offer by ID
 */
app.get('/cancelTradeOffer', (req, res) => {
    let id = req.query.tradeid;

    manager.getOffer(id, (err, offer) => {
        if (!err) {
            offer.cancel((err) => {
                if (!err) {
                    res.send(response('Trade offer canceled!'));
                } else {
                    console.error(err);
                    res.send(errorResponse(err));
                }
            })
        } else {
            console.error(err);
            res.send(errorResponse(err));
        }
    });
});

/**
 * Sends trade offer to user
 */
app.post('/sendTradeOffer', (req, res) => {
    let encoded_data = req.body.items;
    let data = JSON.parse(encoded_data);
    let itemsParsed = data.encoded_items;

    let offer = manager.createOffer(data.tradelink);
    offer.setMessage(data.message);

    // Adds every item in the trade
    for (let i = 0; i < itemsParsed.length; i++) {
        let addedItem = offer.addTheirItem({
            assetid: itemsParsed[i].assetid,
            appid: itemsParsed[i].appid,
            contextid: itemsParsed[i].contextid,
            amount: 1
        });

        // Debug every item added and abort if any failed
        if (addedItem) {
            let index = i + 1;

            log(`Added item sucessfully [${index} / ${itemsParsed.length}]: ${itemsParsed[i].assetid}`);
        } else {
            log(`Failed to add item: ${itemsParsed[i].assetid}`);

            res.send(errorResponse(new Error('Failed to add item to trade offer.')));
        }
    }

    log('Added all items sucessfully!');

    // Send trade offer
    offer.send(function (err, status) {
        if (!err) {
            log('Sent Trade Offer!');
            res.send(response(offer));

            return;
        }

        log('Error trying to send trade offer, refreshing session and retrying again...');
        client.webLogOn();

        offer.send(function (err2, status2) {
            if (!err2) {
                log('Trade Offer sent!');
                res.send(response(offer));
            } else {
                log('Failed to send trade offer even refreshing session!');
                console.error(err2);
                res.send(errorResponse(err2));
            }
        });
    });
});

app.get('/logs', (req, res) => {
    res.type('text');
    res.send(response(fs.readFileSync(LOGS_PATH, {encoding: 'utf8'})));
});

app.get('/stdout', (req, res) => {
    res.type('text');
    res.send(response(fs.readFileSync(STDOUT_PATH, {encoding: 'utf8'})));
});

app.get('/stderr', (req, res) => {
    res.type('text');
    res.send(response(fs.readFileSync(STDERR_PATH, {encoding: 'utf8'})));
});

app.get('/kill', (req, res) => {
    res.type('text');
    res.send('Killing this instance');
    process.exit(1); // Fatal error since we couldn't get our API key
});


app.listen(HTTP_PORT, () => {
    log('Logging on ' + LOGS_PATH);
    log('STDOUT on: ' + STDOUT_PATH);
    log('STDERR on: ' + STDERR_PATH);

    log('Listening on ' + HTTP_PORT);
});