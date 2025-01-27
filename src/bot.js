const fs = require('fs');
const {log} = require('./helpers');
const CHATS_PATH = './chats.json';

let bot = null;
let lastRequest = null;
let chats = [];

const loadChats = () => {
    if (fs.existsSync(CHATS_PATH))
        chats = JSON.parse(fs.readFileSync(CHATS_PATH));
};

const saveChatId = (id) => {
    let exists = false;
    if (fs.existsSync(CHATS_PATH)) {
        loadChats();
    }

    if (chats.indexOf(id) === -1) {
        chats.push(id);
    } else {
        exists = true;
    }

    fs.writeFileSync(CHATS_PATH, JSON.stringify(chats));

    return !exists;
};

export const sendMessage = (message) => {
    loadChats();
    for (let id of chats) {
        bot.sendMessage(id, message);
    }
};

export const askFor2FACode = () => {
    if (lastRequest)
        clearTimeout(lastRequest);

    sendMessage("API is requesting 2FA code...");

    return new Promise((res, rej) => {
        lastRequest = (code) => {
            res(code);
            lastRequest = null;
        };
    });
};

export const setupBot = (_bot) => {
    bot = _bot;
    bot.onText(/\/(start|register)/, (msg) => {
        let reply = '';

        if (saveChatId(msg.chat.id)) {
            reply = 'Registered to receive Steam Account events.';
        } else {
            reply = 'Chat already registered!';
        }

        bot.sendMessage(msg.chat.id, reply);
    });

    bot.onText(/^([A-Za-z0-9]{5})$/, (msg, match) => {
        let code = match[1];
        log(`Received 2FA code ${code}`);

        if (lastRequest)
            lastRequest(code);
    })
};