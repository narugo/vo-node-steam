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

var session;

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
    bot.setPersonaName('_ben (nodejs)(v3)');
});

bot.on('webSessionID', function (sessionID) {
    session = sessionID;
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

var tradeHistory;

var trades = [];
var getTrades = function (callback, source) {
    if (source) bot.sendMessage(source, "Downloading trades...");
    misc.getJSON({
        host: config.tradeJsonHost,
        path: config.tradeJsonPath,
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
    }, steamid);
};

bot.on('tradeProposed', function (tradeID, otherClient) {
    bot.respondToTrade(tradeID, false);
    listTrades(otherClient);
});

bot.on('friend', function (steamid, friendtype) {

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
        bot.sendMessage(source, "'list': Prints active trades");
        bot.sendMessage(source, "'ls': Prints active trades");
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

    message = message.replace("(", "");
    message = message.replace(")", "");

    //if number
    if (message.match(/^\d+$/)) {

        var tradingFor = trades[(message - 1)];

        getTrades(function (trades) {

            if (message <= trades.length && message > 0) {
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
                
                //check if i have enough of that item
                var errors = [];
                for (var i = 0; i < tradingFor.items.length; i++) {
                    if (!(inventory.filter(function (item) { return item.app_data.def_index == tradingFor.items[i].item; }).length >= tradingFor.items[i].amount)) {
                        errors.push("Sorry! I do not have enough " + misc.item(tradingFor.items[i].item) + ".");
                        console.log('Bot didnt have enough: ' + misc.item(tradingFor.items[i].item));
                    }
                }
                if (errors.length !== 0) {
                    for (var a = 0; a < errors.length; a++) {
                        bot.sendMessage(source, errors[a]);
                    }
                    return;
                }

                //check client metal
                
                offers.loadPartnerInventory(source, 440, 2, function (success, z) {
                    if (success !== null) {
                        bot.sendMessage(source, "Error accessing Steam API. Please try again later. (" + success + ")");
                        return;
                    }

                    clientInventory = z;

                    if (tradingFor.hasOwnProperty("ref")) {
                        bot.sendMessage(source, "Counting metal...");

                        var metal = {
                            "refined": 1.00,
                            "reclaimed": 0.33,
                            "scrap": 0.11,
                        };

                        var theirScrap = clientInventory.filter(function (item) { return item.app_data.def_index == 5000; }).length;
                        var theirRec = clientInventory.filter(function (item) { return item.app_data.def_index == 5001; }).length;
                        var theirRef = clientInventory.filter(function (item) { return item.app_data.def_index == 5002; }).length;

                        var theirScrapTotal = 0.00;
                        for (var i = 0; i < theirScrap; i++) {
                            //theirRecTotal = 0.33
                            var float = parseFloat("0." + (theirScrapTotal).toString().split('.')[1]);
                            console.log("their scrap: ");
                            console.log(float);
                            var nextToAdd = 0.11;
                            if (float === 0.88) {
                                nextToAdd = 0.12;
                            }
                            console.log(theirScrapTotal);

                            theirScrapTotal = parseFloat((theirScrapTotal + nextToAdd).toFixed(2));
                        }
                        console.log(theirScrapTotal);

                        var theirRecTotal = 0.00;
                        for (var i = 0; i < theirRec; i++) {
                            //theirRecTotal = 0.33
                            var float = parseFloat("0." + (theirRecTotal).toString().split('.')[1]);
                            console.log("thier rec: ");
                            console.log(float);
                            var nextToAdd = 0.33;
                            if (float === 0.66) {
                                nextToAdd = 0.34;
                            }

                            theirRecTotal = parseFloat((theirRecTotal + nextToAdd).toFixed(2));
                        }
                        console.log(theirRecTotal);

                        var theirRefTotal = theirRef * metal.refined;

                        var theirTotalMetal = parseFloat((theirScrapTotal + theirRecTotal).toFixed(2)) + theirRefTotal;

                        var neededRef = tradingFor.ref;

                        if (theirTotalMetal < tradingFor.ref) {
                            bot.sendMessage(source, "You don't have enough metal for this trade. You need " + (tradingFor.ref - theirTotalMetal) + " more.");
                            console.log("client did not have enough metal");
                            return;
                        }

                        var currentOffer = 0;
                        var theirMetalOffer = {
                            "ref": 0,
                            "rec": 0,
                            "scrap": 0
                        };

                        //add progressively
                        //add refined
                        for (var i = 0; i < theirRef; i++) {
                            if ((currentOffer + metal.refined) <= neededRef) {
                                theirMetalOffer.ref++;
                                currentOffer += metal.refined;
                                console.log(theirMetalOffer.ref + ":" + currentOffer);
                            } else {
                                break;
                            }
                        }

                        //add reclaimed
                        console.log("adding reclaimed...");
                        for (var i = 0; i < theirRec; i++) {
                            if ((currentOffer + metal.reclaimed) <= neededRef) {
                                theirMetalOffer.rec++;

                                //instead of add 0.33, add 0.34 if 0.66
                                var float = parseFloat("0." + (currentOffer).toString().split('.')[1]);
                                var nextToAdd = 0.33;
                                if (float === 0.66) {
                                    nextToAdd = 0.34;
                                }

                                //var float = parseFloat((parseFloat((currentOffer + metal.reclaimed).toFixed(2)) % 1).toFixed(2));
                                //if (float === 0.99) float = 1.00;
                                //console.log("float: " + float);

                                currentOffer = parseFloat((currentOffer + nextToAdd).toFixed(2));
                            } else {
                                break;
                            }
                        }
                        console.log(theirMetalOffer);
                        console.log("currentOffer: " + currentOffer);

                        //add scraps
                        console.log("adding scraps...");
                        for (var i = 0; i < theirScrap; i++) {
                            if ((currentOffer + metal.scrap) <= neededRef) {
                                theirMetalOffer.scrap++;

                                //currentOffer = parseFloat((currentOffer + metal.scrap).toFixed(2));

                                //instead of add 0.33, add 0.34 if 0.66
                                var float = parseFloat("0." + (currentOffer).toString().split('.')[1]);
                                var nextToAdd = 0.11;
                                if (float === 0.88) {
                                    nextToAdd = 0.12;
                                }
                                currentOffer = parseFloat((currentOffer + nextToAdd).toFixed(2));
                            } else {
                                break;
                            }
                        }
                        console.log("currentOffer after adding scraps: " + currentOffer);
                        console.log(theirMetalOffer);

                        var myChangeOffer = 0;

                        function buildChange() {
                            //calculate my change
                            //eg currentOffer = 7, neededRef = 6.33
                            console.log("========");
                            console.log(currentOffer);
                            console.log(neededRef);
                            var change = parseFloat((currentOffer - neededRef).toFixed(2));
                            console.log("I need to provide: " + change + " change");

                            var myChangeMetals = {
                                "ref": 0,
                                "rec": 0,
                                "scrap": 0
                            };

                            //count my metals
                            var myMetal = {
                                "ref": inventory.filter(function (item) { return item.app_data.def_index == 5002; }),
                                "rec": inventory.filter(function (item) { return item.app_data.def_index == 5001; }),
                                "scrap": inventory.filter(function (item) { return item.app_data.def_index == 5000; })
                            };

                            myChangeOffer = 0;

                            //add ref
                            for (var i = 0; i < myMetal.ref.length; i++) {
                                if ((myChangeOffer + metal.refined) <= change) {
                                    myChangeMetals.ref++;
                                    myChangeOffer = parseFloat((myChangeOffer + metal.ref).toFixed(2));
                                } else {
                                    break;
                                }
                            }

                            //add ref
                            for (var i = 0; i < myMetal.rec.length; i++) {
                                if ((myChangeOffer + metal.reclaimed) <= change) {
                                    myChangeMetals.rec++;
                                    myChangeOffer = parseFloat((myChangeOffer + metal.rec).toFixed(2));
                                } else {
                                    break;
                                }
                            }

                            //add scraps
                            for (var i = 0; i < myMetal.scrap.length; i++) {
                                if ((myChangeOffer + metal.scrap) <= change) {
                                    myChangeMetals.scrap++;
                                    myChangeOffer = parseFloat((myChangeOffer + metal.scrap).toFixed(2));
                                } else {
                                    break;
                                }
                            }

                            console.log("I have provided: " + myChangeOffer + " change");
                            console.log(myChangeMetals);

                            buildOffers(theirMetalOffer, myChangeMetals, myMetal);
                        }//end buildChange

                        function buildOffers(clientMetalOffer, botChangeMetals, botMetal) {
                            console.log("final===================");
                            console.log(clientMetalOffer);
                            console.log(botChangeMetals);


                            //build offers
                            function newItem(assetid) {
                                return {
                                    "appid": 440,
                                    "contextid": 2,
                                    "amount": 1,
                                    "assetid": assetid
                                };
                            }
                            //build their offer
                            var theirItemOffer = [];
                            var myItemOffer = [];
                            //get their metal
                            var theirRef = clientInventory.filter(function (item) { return item.app_data.def_index == 5002; });
                            var theirRec = clientInventory.filter(function (item) { return item.app_data.def_index == 5001; });
                            var theirScrap = clientInventory.filter(function (item) { return item.app_data.def_index == 5000; });

                            theirRef.length = clientMetalOffer.ref;
                            theirRec.length = clientMetalOffer.rec;
                            theirScrap.length = clientMetalOffer.scrap;

                            //add refs
                            for (var i = 0; i < clientMetalOffer.ref; i++) {
                                theirItemOffer.push(new newItem(theirRef[i].id));
                            }
                            //add recs
                            for (var i = 0; i < clientMetalOffer.rec; i++) {
                                theirItemOffer.push(new newItem(theirRec[i].id));
                            }
                            //add refs
                            for (var i = 0; i < clientMetalOffer.scrap; i++) {
                                theirItemOffer.push(new newItem(theirScrap[i].id));
                            }
                            console.log(theirItemOffer);

                            //now build my offer
                            var myKeys = inventory.filter(function (item) { return item.app_data.def_index == tradingFor.items[0].item; });
                            for (var i = 0; i < tradingFor.items[0].amount; i++) {
                                myItemOffer.push(new newItem(myKeys[i].id));
                            }


                            //now add change to my offer
                            //add refs
                            for (var i = 0; i < botChangeMetals.ref; i++) {
                                myItemOffer.push(new newItem(botMetal.ref[i].id));
                            }
                            //add rec
                            for (var i = 0; i < botChangeMetals.rec; i++) {
                                myItemOffer.push(new newItem(botMetal.rec[i].id));
                            }
                            //add scrap
                            for (var i = 0; i < botChangeMetals.scrap; i++) {
                                myItemOffer.push(new newItem(botMetal.scrap[i].id));
                            }
                            console.log(myItemOffer);

                            sendOffer(myItemOffer, theirItemOffer);
                        }

                        function sendOffer(botOffer, clientOffer) {
                            //*
                            //final check
                            if ((parseFloat((currentOffer - myChangeOffer).toFixed(2))) == neededRef) {
                                console.log("correct offers: " + (parseFloat((currentOffer - myChangeOffer).toFixed(2))));
                            } else {
                                console.log("incorrect offers: " + (currentOffer - myChangeOffer));
                                bot.sendMessage(source, "Error calculating inventory. Trade logged.");
                                return;
                            }

                            offers.makeOffer(source, 'Getting an error? Restart Steam.', botOffer, clientOffer, function (error, object) {
                                if (error == null) {
                                    bot.sendMessage(source, "A trade offer (" + object.tradeofferid + ") has been sent containing the item(s): https://steamcommunity.com/my/tradeoffers");
                                    bot.sendMessage(source, "Type 'list' or 'ls' to see other trades. Getting an error? Restart Steam.");
                                    bot.sendMessage(config.admin[0], "Trade sent to: " + bot.users[source].playerName + ". Bought: " + tradingFor.ref + " with: " + currentOffer + " (change given: " + myChangeOffer+")");
                                    console.log(object.tradeofferid + " Trade offer send to: " + bot.users[source].playerName);
                                } else {
                                    console.log(error);
                                    bot.sendMessage(source, "Error creating trade offer. " + error);
                                }
                            }); //end trade offer
                            //*/
                        }

                        //check if i need to add change
                        if (currentOffer < tradingFor.ref) {
                            bot.sendMessage(source, "Calculating change...");
                            console.log("They need to add more metal");

                            //add extra to client offer
                            var theirMetalLeftToAdd = {
                                "ref": (theirRef - theirMetalOffer.ref),
                                "rec": (theirRec - theirMetalOffer.rec),
                                "scrap": (theirScrap - theirMetalOffer.scrap)
                            };

                            //add progressively
                            console.log("Adding reclaimed to currentOffer");

                            //add rec
                            for (var i = 0; i < theirMetalLeftToAdd.rec; i++) {
                                if ((currentOffer + metal.reclaimed) >= neededRef) {
                                    theirMetalOffer.rec++;
                                    currentOffer = parseFloat((currentOffer + metal.reclaimed).toFixed(2));
                                    console.log("extra rec: " + currentOffer);
                                    break;
                                } else {
                                    break;
                                }
                            }

                            //check again if reach
                            if (currentOffer < neededRef) {
                                console.log("still not met, adding scraps");

                                //add scraps
                                for (var i = 0; i < theirMetalLeftToAdd.scrap; i++) {
                                    if ((currentOffer + metal.scrap) >= neededRef) {
                                        theirMetalOffer.scrap++;
                                        currentOffer = parseFloat((currentOffer + metal.scrap).toFixed(2));
                                        console.log("extra scrap: " + currentOffer);
                                    } else {
                                        break;
                                    }
                                }
                            } else {
                                console.log("now i need to add my change");
                                buildChange();
                            }
                        } else if (currentOffer === tradingFor.ref) {
                            //send trade offer
                            buildChange();
                        }

                    }//end has property ref
                    else {
                        //use standard swap
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

                        bot.sendMessage(source, "Loading...");

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
                        offers.makeOffer(source, 'Getting an error? Restart Steam.', myItemOfferReady, theirItemOfferReady, function (error, object) {
                            if (error == null) {
                                bot.sendMessage(source, "A trade offer (" + object.tradeofferid + ") has been sent containing the item(s): https://steamcommunity.com/my/tradeoffers");
                                bot.sendMessage(source, "Type 'list' or 'ls' to see other trades.");
                                bot.sendMessage(config.admin[0], object.tradeofferid + " Trade offer send to: " + bot.users[source].playerName);
                            } else {
                                console.log(error);
                                bot.sendMessage(source, "Error creating trade offer. " + error);
                                bot.sendMessage(config.admin[0], "Error in making trade offer: " + bot.users[source].playerName + error);

                                //create new session
                                bot.webLogOn(function (cookies) {
                                    offers.setup(session, cookies);
                                });
                            }
                        }); //end trade offer
                    }
                });//end load partner inv
            });//end load my inv
        });//end get trades
    } //end if number
});

offers.on('msg', function (id, msg) {
    bot.sendMessage(id, msg);
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

