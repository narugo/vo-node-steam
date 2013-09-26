var express = require('express');
var config = require('config');

var app = express();
app.use(express.logger());
app.use(express.bodyParser());

var port = process.env.PORT || 5000;
app.listen(port, function() {
    console.log("Listening on " + port);
});



/////////////////////////////////////////////////////////////steam///////////////////////////


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
catch (e) {
    // statements to handle any exceptions
    console.log(e);
}

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
        console.log('CM: ' + bot.users[source].playerName + ' << ' + message);

        if (message.toLowerCase().indexOf('trade') !== -1) {
            console.log('TR: ' + bot.users[source].playerName + ' wants to trade with bot #' + bot.steamID);
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
            bot.sendMessage(steamid, "Thank you for adding me.");
            bot.sendMessage(steamid, "http://voiid.net/");
            bot.sendMessage(steamid, "http://steamcommunity.com/id/_ben");
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

var tempuser = "";
var tradingFor;

/*var trades = [
    //format = [ cost of item in array, "casual cost", "casual name", "def_index" ]
    [["5000"], "1 Scrap", "Sydney Sleeper", "230"],
    [["5000", "5000"], "2 buds", "Test Item 2", "0"]
];

*/

var trades = [
    sydney = {
        casualCost: "1 scrap",
        cost: [5000],
        name: "Sydney Sleeper",
        index: '230'
    },
    scrap = {
        casualCost: "1 scrap",
        cost: [5000],
        name: "Scrap",
        index: '5000'
    }
];

bot.on('tradeProposed', function (tradeID, otherClient) {
    bot.respondToTrade(tradeID, true);
});

bot.on('sessionStart', function (otherclient) {
    bot.setPersonaState(Steam.EPersonaState.Busy);
    tempuser = otherclient;

    inventory = [];
    scrap = [];
    weapons = 0;
    addedScrap = [];
    client = otherclient;

    console.log("TR: "+bot.users[client].playerName+" is now trading with bot");
    steamTrade.open(otherclient);

    steamTrade.chatMsg('Please wait while I load my inventory...');

    steamTrade.loadInventory(440, 2, function (inv) {
        
        inventory = inv;

        steamTrade.chatMsg('Inventory loaded.');

        /*for (var i = 0; i < trades.length; i++) {
            var itemname = trades[i][trades[i].length - 2];
            var itemid = trades[i][trades[i].length - 1];
            var itemcost = trades[i][0];
            var itemcoststring = trades[i][1];

            //trades[i][trades[0]];
            steamTrade.chatMsg(itemname + " (" + itemid + "): "+itemcoststring);
        */

        for (var i = 0; i < trades.length; i++) {
            steamTrade.chatMsg(trades[i].name + " (" + trades[i].index + "): "+trades[i].casualCost);
        }

        steamTrade.chatMsg('Please type the number of the item you\'d wish to buy. E.g. 230');
        
    });
    
});

steamTrade.on('offerChanged', function (added, item) {
    steamTrade.unready();
    
    if (item.tags && item.tags.some(function (tag) {
        return ~['primary', 'secondary', 'melee', 'pda2'].indexOf(tag.internal_name);
    }) && (item.descriptions === '' || !item.descriptions.some(function (desc) {
        return desc.value == '( Not Usable in Crafting )';
    }))) {
        // this is a craftable weapon
        //steamTrade.chatMsg("You "+ (added ? 'added' : 'false') + " a craftable weapon");
        
    }
    console.log(steamTrade.themAssets);
});

steamTrade.on('unready', function () {
    steamTrade.unready();
});

steamTrade.on('ready', function () {

    //validate
    //validate();

    steamTrade.ready(function () {
        steamTrade.confirm();
    });
});

steamTrade.on('chatMsg', function (msg) {

    for (var i = 0; i < trades.length; i++) {
        if (trades[i].index == msg) {
            console.log(i + " yes");
            tradingFor = trades[i];

            steamTrade.chatMsg("You are now trading for: " + tradingFor.name);
            steamTrade.chatMsg("Please put up: " + tradingFor.casualCost);


            steamTrade.addItems(inventory.filter(function (item) { return item.app_data.def_index == msg; })[0]);
            break;
        }
    }

    if (config.isAdmin(client)) {
        if (msg == 'give') {
            steamTrade.addItems(inventory);
        }
        if (msg.toLowerCase().indexOf('giveme') !== -1) {
            msg = msg.replace('giveme ', '');
            var item = steamTrade.addItems(inventory.filter(function (item) { return item.name == msg; }));
        }
    } 
});

steamTrade.on('end', function (result) {
    console.log('trade', result);
    bot.setPersonaState(Steam.EPersonaState.LookingToTrade);

    bot.sendMessage(tempuser, 'Thanks for using this bot!');
    bot.sendMessage(tempuser, 'Please send feedback and suggestions to http://steamcommunity.com/id/_ben');
    tempuser = null;
});


///////////////////////////////////end trading//////////////////////////////////
app.all('/', function (request, response) {
    response.header("Access-Control-Allow-Origin", '*');
    response.header("Access-Control-Allow-Headers", "Content-Type");
    response.header("Access-Control-Allow-Methods", "POST, GET");
    response.header("Access-Control-Max-Age", "86400");
    response.end('ok');
});

app.get('/', function (request, response) {
    response.send('hello');
});


///sending data

//initial turn on bot
app.post('/init', function (request, response) {
    console.log(request.body);
    logOn();
});


//test friend request
app.post('/addfriend', function (request, response) {
    response.header("Access-Control-Allow-Origin", 'http://ben.voiid.net');

    logOn();
    console.log(request.body);
    bot.addFriend(request.body.steamid);

    response.end("bot has sent "+req.body.steamid+" a friend request");
});

app.get('/recover', function (request, response) {
    bot.removeFriend(config.admin);
    bot.addFriend(config.admin);
    response.send("recovered");
});

app.get('/test', function (request, response) {
    logOn();
    response.send("ok");
});

app.get('/offline', function (request, response) {
    logOffline();
});
