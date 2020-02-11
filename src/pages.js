import {
    log,
    response,
    error as errorResponse,
} from "./helpers";
import {SteamID} from 'steamcommunity';
import {STEAM_LOGON_DATA} from "./index";

export const setup = (client, manager, app) => {
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
                log('Successfully returned offer #' + offer_id);
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
                log(`Added item sucessfully [${i + 1} / ${itemsParsed.length}]: ${itemsParsed[i].assetid}`);
            } else {
                log(`Failed to add item: ${itemsParsed[i].assetid}`);

                res.send(errorResponse(new Error('Failed to add item to trade offer.')));
            }
        }

        log('Added all items sucessfully!');

        // Send trade offer
        offer.send((err, status) => {
            if (!err) {
                log('Sent Trade Offer!');
                res.send(response(offer));

                return;
            }

            log('Error trying to send trade offer, refreshing session and retrying again...');
            if (client.SteamID) {
                client.webLogOn();
            } else {
                client.logOn(STEAM_LOGON_DATA);
            }

            const sendAgain = () => {
                offer.send((err2, status2) => {
                    if (!err2) {
                        log('Trade Offer sent!');
                        res.send(response(offer));
                    } else {
                        log('Failed to send trade offer even refreshing session!');
                        console.error(err2);
                        res.send(errorResponse(err2));
                    }
                });
            };

            setTimeout(sendAgain, 5000);
        });
    });

    app.get('/kill', (req, res) => {
        res.type('text');
        res.send('Killing this instance');
        process.exit(1); // Fatal error since we couldn't get our API key
    });
};
