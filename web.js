var express = require('express');
var http = require('http');
var config = require('config');

var app = express();
app.use(express.logger());
app.use(express.bodyParser());

app.configure(function () {
    app.set('title', 'vo-node-steam');
});

app.listen(port, function() {
    console.log("Listening on " + (process.env.PORT || 5000));
});



////////////////////////////////////////////steam////////////////////////////////////////////
var Steam = require('steam');
var SteamTrade = require('steam-trade');
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
    bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
});

bot.on('webSessionID', function (sessionID) {
    steamTrade.sessionID = sessionID;
    bot.webLogOn(function (cookies) {
        for (var i = 0; i < cookies.length; i++) {
            steamTrade.setCookie(cookies[i]);
        }
    });
    bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
    console.log('Bot: Logged into SteamCommunity');
});

bot.on('message', function (source, message, type, chatter) {
    if (message.length > 0) {
        console.log('(Chat) ' + bot.users[source].playerName + ': ' + message);

        if (message.toLowerCase().indexOf('trade') !== -1) {
            console.log('(rade) ' + bot.users[source].playerName + ' wants to trade with bot #' + bot.steamID);
            bot.sendMessage(source, 'Sending you a trade invite.', Steam.EChatEntryType.ChatMsg);
            bot.trade(source);
        }
        if (message.toLowerCase().indexOf('about') !== -1) {
            bot.sendMessage(source, '_ben http://steamcommunity.com/id/_ben', Steam.EChatEntryType.ChatMsg);
        }
        if (message.toLowerCase().indexOf('logoff') !== -1) {
            bot.logOff();
        }
        if (message.toLowerCase().indexOf('day') !== -1) {
            bot.sendMessage(source, 'http://sidoxia.files.wordpress.com/2012/10/apple-pie.jpg', Steam.EChatEntryType.ChatMsg);
        }
        if (message.toLowerCase().indexOf('shutdownnode') !== -1) {
            console.log('!!! server shutdown by ' + source + ' !!!');
            process.exit(0);
        }
        if (message.toLowerCase().indexOf('message ') !== -1) {
            message = message.replace("message ", "");
            bot.sendMessage(config.admin[0], "(Feedback) " + bot.users[source].playerName + ": " + message);
        }
    }
});

bot.on('friend', function (steamid, friendtype) {
    //https://github.com/seishun/node-steam/blob/master/lib/generated/steam_language.js
    switch (friendtype) {
        case 0:
            console.log('Bot was removed as friend by: ' + bot.users[steamid].playerName);
            break;
        case 1:
            break;
        case 2:
            bot.addFriend(steamid);
            console.log(steamid + ' added me as friend. I have accepted');
            break;
        case 3:
            bot.trade(steamid);
            console.log('Bot is now friends with: ' + bot.users[steamid].playerName);
            //start auto trade invite etc, say data about bot request
            break;
        case 4:
            console.log('Bot sent friend request to: ' + bot.users[steamid].playerName);
            break;
    }
});


///////////////////////////////trading////////////////////////////
var inventory;
var scrap;
var weapons;
var addedScrap;
var client;
var nonTradeable;

var tradingFor;
var validated = 0;
var tradeDefArray = [];
var mySaleItem;

var trades = [
    //http://wiki.alliedmods.net/Team_Fortress_2_Item_Definition_Indexes
    sydney = {
        casualCost: "1 Scrap",
        cost: [5000],
        name: "Sydney Sleeper",
        index: "230"
    },
    lastbreath = {
        casualCost: "1 key",
        cost: [5021],
        name: "The Last Breath",
        index: "570"
    },
    bafbills = {
        casualCost: "7keys + 3ref",
        cost: [5021, 5021, 5021, 5021, 5021, 5021, 5021, 5002, 5002, 5002],
        name: "Bill's Hat (Barraclavas are Forever)",
        index: "126"
    }
];

bot.on('tradeProposed', function (tradeID, otherClient) {
    bot.respondToTrade(tradeID, true);
});

bot.on('sessionStart', function (otherclient) {

    bot.webLogOn(function (cookies) {
        for (var i = 0; i < cookies.length; i++) {
            steamTrade.setCookie(cookies[i]);
        }
    });

    bot.setPersonaState(Steam.EPersonaState.Busy);

    inventory = [];
    scrap = [];
    weapons = 0;
    addedScrap = [];
    client = otherclient;

    console.log("(Trade) "+bot.users[client].playerName+" is now trading with bot");
    steamTrade.open(otherclient);

    steamTrade.chatMsg('Please wait while I load my inventory...');

    steamTrade.loadInventory(440, 2, function (inv) {
        
        inventory = inv;

        //steamTrade.chatMsg('Inventory loaded.');
        steamTrade.chatMsg('Please type the number of the item you\'d wish to buy. E.g. 230');

        setTimeout(function () {
            for (var i = 0; i < trades.length; i++) {
                steamTrade.chatMsg("(" + (i+1) + "): " + trades[i].name + ": " + trades[i].casualCost);
            }
        }, 100);
    });
    
});

steamTrade.on('offerChanged', function (added, item) {

    bot.webLogOn(function (cookies) {
        for (var i = 0; i < cookies.length; i++) {
            steamTrade.setCookie(cookies[i]);
        }
    });

    validated = 0;
    steamTrade.unready();

    setTimeout(function () {
        tradeDefArray = [];
        for (var j = 0; j < steamTrade.themAssets.length; j++) {
            tradeDefArray.push(steamTrade.themAssets[j].app_data.def_index);
        }
        console.log(tradeDefArray);
            
        //make sure user has chosen what they want
        if (typeof (tradingFor) != "undefined") {

            //if the clients offered item's def index array does not match our trade cost array
            if (tradeDefArray.sort().join(',') === tradingFor.cost.sort().join(',')) {
                validated = 1;
                steamTrade.chatMsg("Please ready up");
            }
        }
    }, 100);
    
    /*if (item.tags && item.tags.some(function (tag) {
        return ~['primary', 'secondary', 'melee', 'pda2'].indexOf(tag.internal_name);
    }) && (item.descriptions === '' || !item.descriptions.some(function (desc) {
        return desc.value == '( Not Usable in Crafting )';
    }))) {
        // this is a craftable weapon
        //steamTrade.chatMsg("You "+ (added ? 'added' : 'false') + " a craftable weapon");
        
    }*/
});

steamTrade.on('chatMsg', function (msg) {

    for (var i = 0; i < trades.length; i++) {
        if (typeof trades[(msg-1)] == 'undefined') {//trades[i].index == msg
            steamTrade.chatMsg("Try again");
            break;
        } else {        
            //if already chosen an item
            if (typeof (tradingFor) != "undefined") {
                steamTrade.cancel(function () {
                    bot.sendMessage(client, "Currently, I need to start a new trade for each item. Please invite me to trade again, or say 'trade'");
                    bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
                    tradingFor = undefined;
                });
            }

            //check if it is inventory
            if (inventory.filter(function (item) { return item.app_data.def_index == trades[(msg-1)].index; }).length >= 1) {
                //continue trade
                tradingFor = trades[(msg-1)];
                
                steamTrade.chatMsg("You are now trading for: " + tradingFor.name);
                mySaleItem = inventory.filter(function (item) { return item.app_data.def_index == trades[(msg-1)].index; });
                steamTrade.addItems(mySaleItem);
                steamTrade.chatMsg("Please put up: " + tradingFor.casualCost);

            } else {
                console.log("(Trade) Error! Bot doesn't have the item: " + msg);
                bot.sendMessage(config.admin[0], "Trade Error! " + bot.users[client].playerName + ": bot did not have item: " + trades[(msg-1)].name);
                steamTrade.chatMsg("I'm sorry! I don't have this item in my inventory. It might have already been sold. A message has been sent to my master.");
            }
            break;
        }
    }

    if (msg == 'cancel') {
        steamTrade.chatMsg("resetting...");
        steamTrade.removeItem(mySaleItem);
    }

    if (config.isAdmin(client)) {
        if (msg == 'give') {
            steamTrade.addItems(inventory);
        }
        if (msg == "deposit") {
            validated = 1;
        }
    }
});

steamTrade.on('unready', function () {
    steamTrade.unready();
});

steamTrade.on('ready', function () {

    //validate
    if (validated === 1) {
        steamTrade.ready(function () {
            steamTrade.confirm();
        });
    } else {
        if (typeof (tradingFor) == "undefined") {
            steamTrade.chatMsg("Please type the number of the item you'd wish to buy. E.g. 230");
        } else {
            steamTrade.chatMsg("You are missing some requirements: " + tradingFor.casualCost);
        }
    }
});

steamTrade.on('end', function (result) {
    console.log('Trade', result);
    bot.setPersonaState(Steam.EPersonaState.LookingToTrade);
    bot.sendMessage(client, 'Thanks for using this bot!');
    bot.sendMessage(client, "Please send feedback and suggestions to http://steamcommunity.com/id/_ben or type message followed my your message. E.g. message Nice Bot!");

    //resets
    tradingFor = undefined;
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
