var express = require('express');
var http = require('http');
var config = require('config');

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
var SteamTrade = require('steam-trade');

var SteamTradeOffers = require('steam-tradeoffers');
var offers = new SteamTradeOffers();

var bot = new Steam.SteamClient();
var steamTrade = new SteamTrade();

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
        bot.logOn({
            accountName: config.username,
            password: config.password,
            shaSentryfile: config.shaSentryFile
        });
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
    steamTrade.sessionID = sessionID;
    bot.webLogOn(function (cookies) {
        for (var i = 0; i < cookies.length; i++) {
            steamTrade.setCookie(cookies[i]);
        }

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
var inventory;
var clientInventory;
var client;
var canTrade = false;

var tradingFor;
var validated = 0;
var tradeDefArray = [];
var mySaleItem;

var metal = {
    "scrap": 5000,
    "reclaimed": 5001,
    "refined": 5002
}

var trades = [
    //http://wiki.alliedmods.net/Team_Fortress_2_Item_Definition_Indexes
    {
        name: "Sydney Sleeper",
        items: [
            { "item": 230, "amount": 1 },
            { "item": 570, "amount": 1 }
        ],
        cost: [
            { "item": metal.scrap, "amount": 3 },
            { "item": metal.refined,"amount": 3 }
        ],
        casualCost: "1 Scrap"
    }
];

function listTrades(steamid) {
    //send trades msg
    bot.sendMessage(steamid, 'Please type the number of the item you\'d wish to buy. E.g. 1');

    for (var i = 0; i < trades.length; i++) {
        bot.sendMessage(steamid, "(" + (i + 1) + "): " + trades[i].name + ": " + trades[i].casualCost);
    }
};

bot.on('tradeProposed', function (tradeID, otherClient) {
    bot.respondToTrade(tradeID, false);
    listTrades(otherClient);
});

bot.on('friend', function (steamid, friendtype) {

    offers.loadMyInventory(440, 2, function (success, inv) {
        inventory = inv;
        console.log('Loaded inventory');
    });

    //https://github.com/seishun/node-steam/blob/master/lib/generated/steam_language.js
    switch (friendtype) {
        case 0:
            console.log('Bot was removed as friend by: ' + bot.users[steamid].playerName);
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


bot.on('message', function (source, message, type, chatter) {
    client = source;

    if (message.length > 0) {
        console.log('(Chat) ' + bot.users[source].playerName + ': ' + message);

        if (message.toLowerCase() == "help") {
            bot.sendMessage(source, "Commands: ");
            bot.sendMessage(source, "list: Prints active trades");
            bot.sendMessage(source, "ls: Prints active trades");
        }

        if (["list", "ls"].indexOf(message.toLowerCase()) > -1) {
            listTrades(source);
        }

        if (message.toLowerCase().indexOf('logoff') !== -1) {
            bot.logOff();
        }

        //if number
        if (message.match(/^\d+$/)) {

            //set users trade
            for (var i = 0; i < trades.length; i++) {

                //check if it is inventory
                if (inventory.filter(function (item) { return item.app_data.def_index == trades[(message - 1)].items[0].item; }).length >= 1) {

                    //now check if client has required items
                    offers.loadPartnerInventory(source, 440, 2, function (success, z) {
                        clientInventory = z;

                        var errors = [];

                        //check if client has each amount of items
                        for (var k = 0; k < trades[(message - 1)].cost.length; k++) {
                            console.log("Trade requires: " + trades[(message - 1)].cost[k].item + " x " + trades[(message - 1)].cost[k].amount);
                            
                            //console.log(trades[(message - 1)].cost[k].amount);
                            //console.log(clientInventory.filter(function (item) { return item.app_data.def_index == trades[(message - 1)].cost[k].item; }).length);

                            if (clientInventory.filter(function (item) { return item.app_data.def_index == trades[(message - 1)].cost[k].item; }).length >= trades[(message - 1)].cost[k].amount) {
                                
                            } else {
                                errors[errors.length] = "Not enough: " + trades[(message - 1)].cost[k].item;
                            }
                        }

                        if (errors.length !== 0) {
                            console.log("error!");
                            for (var a = 0; a < errors.length; a++) {
                                bot.sendMessage(source, errors[a]);
                            }
                            return;
                        } else {
                            //continue trade
                            tradingFor = trades[(message - 1)];

                            bot.sendMessage(source, "You are now trading for: " + tradingFor.name);

                            var myItemOffer = [];
                            var theirItemOffer = [];


                            //build myItemOffer
                            for (var k = 0; k < trades[(message - 1)].items.length; k++) {

                                //add each amount of clientinventory array to theiritemoffer
                                var temp = inventory.filter(function (item) { return item.app_data.def_index == tradingFor.items[k].item; });
                                temp.length = trades[(message - 1)].items[k].amount;

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
                            console.log(theirItemOfferReady);
                            console.log(myItemOfferReady);
                            

                            //*/send trade offer
                            offers.makeOffer(source, 'this is a test message', myItemOfferReady, theirItemOfferReady, function (error, object) {
                                if (error == null) {
                                    bot.sendMessage(source, "A trade offer (" + object.tradeofferid + ") has been sent containing the item(s): http://steamcommunity.com/my/tradeoffers");
                                } else {
                                    bot.sendMessage(source, "Error creating trade offer. Please try again later.");
                                }
                            });
                            //*/
                        }
                    });                   

                } else {
                    console.log("(Trade) Error! Bot doesn't have the item: " + message);
                    bot.sendMessage(config.admin[0], "Trade Error! " + bot.users[client].playerName + ": bot did not have item: " + trades[(message - 1)].name);
                    bot.sendMessage(source, "I'm sorry! I don't have this item in my inventory. It might have already been sold. A message has been sent to my master.");
                }
                break;
            }
        }
    }
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

    bot.webLogOn(function (cookies) {
        for (var i = 0; i < cookies.length; i++) {
            steamTrade.setCookie(cookies[i]);
        }
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

