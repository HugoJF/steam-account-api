import dotenv from 'dotenv'
import fs from 'fs';
import cors from 'cors'
import express from 'express';
import timeout from 'connect-timeout'
import bodyParser from "body-parser"

import SteamUser from 'steam-user'
import SteamCommunity from 'steamcommunity'
import TradeOfferManager from 'steam-tradeoffer-manager'
import * as Sentry from '@sentry/node';
import TelegramBot from 'node-telegram-bot-api';

import {haltOnTimeout, log, readTokens, validateToken} from './helpers'
import {setup} from './pages';
import {askFor2FACode, setupBot, sendMessage} from "./bot";

dotenv.config({path: __dirname + '/../.env'});

const SteamID = SteamCommunity.SteamID;
const app = express();


/**************
 * MIDDLEWARE *
 **************/

app.use(validateToken(readTokens()));
app.use(timeout(30000));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
app.use(cors());
app.use(haltOnTimeout);

/*************
 * CONSTANTS *
 *************/
const HTTP_PORT = process.env.HTTP_PORT || 7777;
const TELEGRAM_TOKEN = process.env.TELEGRAM_API_KEY;
export const STEAM_LOGON_DATA = {accountName: process.env.ACCOUNT_NAME, password: process.env.ACCOUNT_PASS};

/*********
 * SETUP *
 *********/
Sentry.init({dsn: process.env.SENTRY_DSN});
const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});

/*********************
 *    WEB LOGGING    *
 *********************/
process.on('uncaughtException', function (err) {
    console.error((err && err.stack) ? err.stack : err);
});

/*******************
 *    VARIABLES    *
 *******************/
let client = new SteamUser({enablePicsCache: true});
let community = new SteamCommunity();
let manager = new TradeOfferManager({
    'steam': client,
    'community': community,
    'domain': 'localhost',
    'language': 'en'
});

client.on('debug', (msg) => log(`[debug] ${msg}`));

client.on('steamGuard', (domain, callback, lastCodeWrong) => {
    log('Received steamGuard event, asking through Telegram Bot');
    askFor2FACode().then((code) => {
        log('Telegram bot replied with 2FA code');
        callback(code);
    });
});

client.on('loggedOn', function (det) {
    log("Logged on");
    sendMessage('Bot is logged in');
    
    client.webLogOn();
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
    process.exit(1);
});

client.on('webSession', (sessionID, cookies) => {
    log("Got web session");
    community.setCookies(cookies);
    manager.setCookies(cookies, (err) => {
        if (err) {
            log(`Failed to retrive account cookies ${err}`);
            process.exit(1); // Fatal error since we couldn't get our API key
            return;
        }

        log(`Got API key: ${manager.apiKey}`);
        log(`Got cookies: ${cookies}`);
    });
});

community.on("sessionExpired", (err) => {
    if (err) log(`Community triggered sessionExpired: ${err}`);

    log('Community triggered sessionExpired, trying to relogging');

    if (client.steamID) {
        log('SteamID is still valid, calling webLogOn');
        client.webLogOn();
    } else {
        log('SteamID is no longer valid, calling logOn');
        client.logOn(STEAM_LOGON_DATA);
    }
});

// Hook PollData to save on change
manager.on('pollData', function (pollData) {
    fs.writeFileSync('polldata.json', JSON.stringify(pollData));
});

/***************
 *    PAGES    *
 ***************/
setup(client, manager, app);
setupBot(bot);


client.logOn(STEAM_LOGON_DATA);

app.listen(HTTP_PORT, () => {
    log('Listening on ' + HTTP_PORT);
});