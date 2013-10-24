var express = require('express');
var http = require('http');
var config = require('config');
var misc = require('misc');

var app = express();
app.use(express.logger());
app.use(express.bodyParser());

app.configure(function () {
    app.set('title', 'vo-node-steam');
});

app.listen((process.env.PORT || 5000), function () {
    console.log("Listening on " + (process.env.PORT || 5000));
});


////////////////////////////////////////////steam////////////////////////////////////////////
var Steam = require('steam');
var SteamTradeOffers = require('steam-tradeoffers');
var offers = new SteamTradeOffers();
var bot = new Steam.SteamClient();

try {
    bot.logOn({
        accountName: config.username,
        password: config.password,
        shaSentryfile: config.shaSentryFile
    });
}
catch (e) { console.log(e); }

var logOn = function () {
    if (bot.loggedOn == false) {
        try {
            bot.logOn({
                accountName: config.username,
                password: config.password,
                shaSentryfile: config.shaSentryFile
            });
        }
        catch (e) { console.log(e); }
    } else bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
};

var logOff = function () {
    bot.logOff();
    console.log("Bot logged off");
}
var logOffline = function () {
    bot.setPersonaState(Steam.EPersonaState.Offline);
}

bot.on('sentry', function (sentryHash) {
    require('fs').writeFile('sentryfile', sentryHash, function (err) {
        if (err) {
            console.log(err);
        } else {
            console.log('Saved sentry file hash as "sentryfile"');
        }
    });
});

bot.on('loggedOn', function () {
    console.log('Bot: Logged into Steam');
    bot.setPersonaName('_ben (nodejs)');
});

bot.on('webSessionID', function (sessionID) {
    bot.webLogOn(function (cookies) {
        offers.setup(sessionID, cookies);
        offers.loadMyInventory(440, 2, function (success, inv) {
            inventory = inv;
            console.log('Loaded inventory');
            bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
        });
    });
    console.log('Bot: Logged into SteamCommunity');    
});

///////////////////////////////trading////////////////////////////
var inventory = [];
var clientInventory;
var client;
var tradingFor;

var tradeHistory

var trades = [];
var getTrades = function (callback) {
    misc.getJSON({
        host: 'url',
        path: 'path',
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    }, function (status, result) {
        if (status == 200) {
            trades = result;
            console.log("Trades updated");

            if (callback) {
                callback(result);
            }
        }
    });
};
getTrades();

function listTrades(steamid) {
    getTrades(function (trades) {
        if (trades.length == 0) {
            bot.sendMessage(steamid, 'No trades available.');
            return;
        }

        //send trades msg
        bot.sendMessage(steamid, 'Please type the number of the trade you would like to do. (e.g. 1)');

        for (var i = 0; i < trades.length; i++) {
            if (trades[i].hasOwnProperty("admin")) {
                if (config.isAdmin(steamid)) {
                    bot.sendMessage(steamid, "(" + (i + 1) + "): " + trades[i].name + ": " + trades[i].casualCost);
                } else {
                    continue;
                }
            } else {
                bot.sendMessage(steamid, "(" + (i + 1) + "): " + trades[i].name + ": " + trades[i].casualCost);
            }
        }
    });    
};

bot.on('tradeProposed', function (tradeID, otherClient) {
    bot.respondToTrade(tradeID, false);
    listTrades(otherClient);
});

bot.on('friend', function (steamid, friendtype) {

    getTrades();

    offers.loadMyInventory(440, 2, function (success, inv) {
        inventory = inv;
    });

    //https://github.com/seishun/node-steam/blob/master/lib/generated/steam_language.js
    switch (friendtype) {
        case 0:
            console.log('Bot was removed as friend by: ' + steamid);
            break;
        case 2:
            bot.addFriend(steamid);
            console.log(steamid + ' added me as friend. I have accepted');
            break;
        case 3:
            console.log('Bot is now friends with: ' + bot.users[steamid].playerName);
            listTrades(steamid);
            break;
    }
});
//
bot.on('message', function (source, message, type, chatter) {
    client = source;

    if (message.length == 0) {
        return;
    }

    console.log('(Chat) ' + bot.users[source].playerName + ': ' + message);

    if (message.toLowerCase() == "help") {
        bot.sendMessage(source, "Commands: ");
        bot.sendMessage(source, "list: Prints active trades");
        bot.sendMessage(source, "ls: Prints active trades");
        return;
    }

    if (["list", "ls"].indexOf(message.toLowerCase()) > -1) {
        listTrades(source);
        return;
    }

    if (config.isAdmin(source) && message.toLowerCase().indexOf('logoff') !== -1) {
        bot.logOff();
        return;
    }

    //if number
    if (message.match(/^\d+$/)) {

        var tradingFor = trades[(message - 1)];

        getTrades(function (trades) {

            if (message <= trades.length) {
                //trade exists
                if (tradingFor.hasOwnProperty("admin")) {
                    if (!config.isAdmin(source)) {
                        bot.sendMessage(source, "Trade does not exist");
                        return;
                    }
                }
            } else {
                bot.sendMessage(source, "Trade does not exist");
                return;
            }

            offers.loadMyInventory(440, 2, function (success, inv) {
                inventory = inv;
                console.log('Reloaded inventory');
            

                //check if bot has that item
                var errors = [];
                for (var i = 0; i < tradingFor.items.length; i++) {
                    //for each item cost

                    if (inventory.filter(function (item) { return item.app_data.def_index == tradingFor.items[i].item; }).length >= tradingFor.items[i].amount) {
                        //bot has enough of this item
                    } else {
                        errors.push("Sorry! I do not have enough " + misc.item(tradingFor.items[i].item) + ".");
                    }
                }

                if (errors.length !== 0) {
                    for (var a = 0; a < errors.length; a++) {
                        bot.sendMessage(source, errors[a]);
                    }
                    return;
                }

                //now check if client has required items
                offers.loadPartnerInventory(source, 440, 2, function (success, z) {
                    clientInventory = z;

                    //check if client has each amount of items
                    var errors = [];
                    for (var k = 0; k < tradingFor.cost.length; k++) {
                        var clientAmount = clientInventory.filter(function (item) { return item.app_data.def_index == tradingFor.cost[k].item; }).length;
                        if (clientAmount >= tradingFor.cost[k].amount) {

                        } else {
                            errors.push("You do not have enough " + misc.item(tradingFor.cost[k].item) + ". You need " + (tradingFor.cost[k].amount - clientAmount) + " more.");
                        }
                    }

                    if (errors.length !== 0) {
                        for (var a = 0; a < errors.length; a++) {
                            bot.sendMessage(source, errors[a]);
                        }
                        return;
                    }

                    bot.sendMessage(source, "You are now trading for: " + tradingFor.name);

                    var myItemOffer = [];
                    var theirItemOffer = [];

                    //build myItemOffer
                    for (var k = 0; k < tradingFor.items.length; k++) {

                        //add each amount of clientinventory array to theiritemoffer
                        var temp = inventory.filter(function (item) { return item.app_data.def_index == tradingFor.items[k].item; });
                        temp.length = tradingFor.items[k].amount;

                        //add temp to theirItemOffer
                        myItemOffer.push(temp);
                    }
                    //console.log(myItemOffer);


                    //build theirItemOffer
                    for (var k = 0; k < tradingFor.cost.length; k++) {

                        //add each amount of clientinventory array to theiritemoffer
                        var temp = clientInventory.filter(function (item) { return item.app_data.def_index == tradingFor.cost[k].item; });
                        temp.length = tradingFor.cost[k].amount;

                        //add temp to theirItemOffer
                        theirItemOffer.push(temp);
                    }
                    //console.log(theirItemOffer);

                    //convert both offers to acceptable objects
                    var myMerged = [];
                    var theirMerged = [];

                    myMerged = myMerged.concat.apply(myMerged, myItemOffer);
                    theirMerged = theirMerged.concat.apply(theirMerged, theirItemOffer);

                    var myItemOfferReady = [];
                    var theirItemOfferReady = [];

                    function newItem(assetid) {
                        return {
                            "appid": 440,
                            "contextid": 2,
                            "amount": 1,
                            "assetid": assetid
                        };
                    }
                    for (var b = 0; b < myMerged.length; b++) {
                        myItemOfferReady.push(new newItem(myMerged[b].id));
                    }
                    for (var b = 0; b < theirMerged.length; b++) {
                        theirItemOfferReady.push(new newItem(theirMerged[b].id));
                    }
                    //completed conversion


                    //*/send trade offer
                    offers.makeOffer(source, 'this is a test message', myItemOfferReady, theirItemOfferReady, function (error, object) {
                        if (error == null) {
                            bot.sendMessage(source, "A trade offer (" + object.tradeofferid + ") has been sent containing the item(s): https://steamcommunity.com/my/tradeoffers");
                            bot.sendMessage(source, "Type 'list' or 'ls' to see other trades.");
                            bot.sendMessage(config.admin[0], object.tradeofferid + " Trade offer send to: " + bot.users[source].playerName);
                        } else {
                            bot.sendMessage(source, "Error creating trade offer. Please try again later.");
                        }
                    }); //end trade offer
                    //*/
                }); //end load inventory
            });//end update trades
        });
    } //end if number
});


///////////////////////////////////end trading//////////////////////////////////
app.get('/', function (request, response) {
    http.get("http://api.uptimerobot.com/getMonitors?apiKey=" + config.uptimeApiKey + "&format=json&noJsonCallback=1", function (res) {
        var body = '';

        res.on('data', function (chunk) {
            body += chunk;
        });

        res.on('end', function () {
            response.send("Overall Uptime: " + JSON.parse(body).monitors.monitor[0].alltimeuptimeratio + "%");
        });
    }).on('error', function (e) {
        response.send(e);
    });
});

app.get('/online', function (request, response) {
    logOn();
    response.send("ok");
});

app.get('/offline', function (request, response) {
    logOffline();
    response.send("ok");
});

