#!/usr/bin/env node


var bot_token = process.env.SLACK_BLOCKBOT_BOT_TOKEN || '';
var web_token = process.env.SLACK_API_WEB_TOKEN || '';
var botUserName = 'blockbot';
var blockBotUserId;

// Using Web API for sending messages instead of the bot, because it supports no message formating
// These args for the "chat postMessage" method are used to pretend to be the bot...
var dmArgs = {
  as_user: false,
  username: botUserName,
  // icon_url: "Use your own icon url here if you like",
};

// Initializing the Real Time Message wrappers
var RtmClient = require('@slack/client').RtmClient;
var WebClient = require('@slack/client').WebClient;
var RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM;
var RTM_EVENTS = require('@slack/client').RTM_EVENTS;
var MemoryDataStore = require('@slack/client').MemoryDataStore;
// var web = new WebClient(web_token, { logLevel: 'debug' });
var web = new WebClient(web_token);
//var rtm = new RtmClient(bot_token, { logLevel: 'debug' });
var rtm = new RtmClient(bot_token, {
  logLevel: 'error',
  dataStore: new MemoryDataStore()
});

rtm.start();

// Initializing the database for permanent moderator storage...
var fs = require("fs");
var file = "data/blockbot.sqlite3";
var exists = fs.existsSync(file);
var sqlite3 = require('sqlite3').verbose();  
var db = new sqlite3.Database(file);
db.run("CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY, channelid TEXT, channelname TEXT, userid TEXT, username TEXT)");


// RTM Authentication
rtm.on(RTM_CLIENT_EVENTS.AUTHENTICATED, function handleRTMAuthenticated() {
  console.log('RTM client authenticated!');
});



// RTM Init
rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, function () {

  console.log('RTM connection openend...')
  try {
    blockBotUserId = rtm.dataStore.getUserByName(botUserName).id;
    console.log('User Id for %s is %s', botUserName, blockBotUserId);
  } catch(e) {
    console.log('Bot not found, please verify that bot user exist in slack, exiting... ', e);
    process.exit(-1);
  }

});



// Catching channel join events for bot invitations
// todo: here we could control, who can invite the bot...
rtm.on(RTM_EVENTS.CHANNEL_JOINED, function handleRtmMessage(message) {

  console.log("JOINED CHANNEL: ", message.channel.name);
  web.chat.postMessage(message.channel.id, botUserName + " has been invited. " +
                                        "*Only channel admins and owners can post at the moment!*\n" +
                                        "They can allow you to post.\n" + 
                                        "How to invite: *@" + botUserName + " add @user*", dmArgs, function () {});
});

// Groups in Slack are actually private channels and DM, we do the same as above for private channels...
rtm.on(RTM_EVENTS.GROUP_JOINED, function handleRtmMessage(message) {

  console.log("JOINED GROUP: ", message.channel.name);
  web.chat.postMessage(message.channel.id, botUserName + " has been invited. " +
                                        "*Only channel admins and owners can post at the moment!*\n" +
                                        "They can allow you to post.\n" + 
                                        "How to invite: *@" + botUserName + " add @user*", dmArgs, function () {});
});



// main event for catching any kind of message for a channel or group
rtm.on(RTM_EVENTS.MESSAGE, function handleRtmMessage(message) {

  // console.log("INCOMING MESSAGE: ", message);

  // escaping certain kind of messaged, we do not want to handle
  if (message.subtype == 'bot_message') {
    return;
  }
  if (message.subtype == 'message_deleted') {
    return;
  }
  if (message.subtype == 'message_changed') {
    return;
  }
  if (message.subtype == 'channel_join') {
    return;
  }
  if (message.subtype == 'channel_leave') {
    whoHasLeft(message);
  }
  if (message.subtype == 'group_leave') {
    whoHasLeft(message);
  }

  // a file, post or code snippet has this subtype, same goes for file comments
  // tweaking text to be able to delete these kind of messages with unique checks later.
  if (message.subtype == 'file_share') {
    message.text = '';
  }
  // currently ignoring comments, not deleting them...
  if (message.subtype == 'file_comment') {
    // message.text = '';
    // message.user = message.comment.user;
    return;
  }

  /* --> threading delete action is currently allowed
  if (message.subtype == 'message_replied') {
    message.text = '';
    if (typeof message.message.user != "undefined") {
      message.user = message.message.user;
    }
    if (typeof message.message.bot_id != "undefined") {
      // If a thread reply to a bot message, delete it regardless of posting user...
      return;
    }
  }
  */

  // ignoring thread messages (maintype) - unfortunately only distinguishable via "thread_ts" field...
  if (typeof message.thread_ts != "undefined") {
    return;
  }
  // ignoring thread messages (subtype)
  if (message.subtype == 'message_replied') {
    return;
  }


  // forking admin (moderator) and delete actions based on message content
  if (!(message.user == 'USLACKBOT' || message.user == blockBotUserId)) {
    if (message.text.indexOf(blockBotUserId) >= 0 && message.user != blockBotUserId) {

      moderatorAdmin(message);

    } else {

      messageAction(message);
 
    }
  }


});



// If the bot is kicked from a group, we delete all moderators from DB
rtm.on(RTM_EVENTS.GROUP_LEFT, function handleRtmMessage(message) {

	  removeChannelFromDB(message);

});

// If the bot is kicked from a channel, we delete all moderators from DB
rtm.on(RTM_EVENTS.CHANNEL_LEFT, function handleRtmMessage(message) {

  removeChannelFromDB(message);

});


function whoHasLeft(message) {
  var channelId = message.Channel;
  var messageUserName = rtm.dataStore.getUserById(message.user).name;
  var channelName = rtm.dataStore.getChannelGroupOrDMById(message.channel).name;
  var channelCreatorId = rtm.dataStore.getChannelGroupOrDMById(message.channel).creator;
  var channelCreatorName = rtm.dataStore.getUserById(channelCreatorId).name;
  var group;
  var listGroupArgs = {
    include_disabled: '0',
    include_count: '1',
    include_users: '1'
  };

  // console.log("Who has left: ", message.text);

  web.usergroups.list(listGroupArgs, function teamInfoCb(err, info) {
    if (err) {

      console.log('Error fetching usergroups: ', err);

    } else {

      for (index1 = 0, len = info.usergroups.length; index1 < len; ++index1) {
        // console.log('Team Info:', info.usergroups[index1].name);
        var groupToChannelMatch = info.usergroups[index1].handle.match(/^(\w+)-team$/);
        if (groupToChannelMatch != null) { groupToChannelMatch = groupToChannelMatch[1]; }
        var channelToGroupMatch = channelName.match(/^([A-Za-z0-9]+)[\_A-Za-z0-9]{0,}/);
        if (channelToGroupMatch != null) { channelToGroupMatch = channelToGroupMatch[1]; }

        if (channelToGroupMatch == groupToChannelMatch) {

          for (index2 = 0, len = info.usergroups[index1].users.length; index2 < len; ++index2) {

            var groupUser = info.usergroups[index1].users[index2];
            if (message.user == groupUser) {

              web.channels.invite(message.channel, message.user, function () {});
              web.groups.invite(message.channel, message.user, function () {});

              web.chat.postMessage(message.user, 
                    "<@" + messageUserName + 
                    ">, You cannot leave <#" + channelId + "|" + channelName + ">" +
                    " because you are in the usergroup that is obliged to be in this channel.\n" +
                    "The Channel owner is <@" + channelCreatorName +
                    "> if you have any questions...", dmArgs, function () {});

              console.log("User %s in matching group %s tried to leave info channel %s !", messageUserName, info.usergroups[index1].handle, channelName);
            }

          }

        }

      }

    }

  });

}


// function for adding or removing channel/group moderators, that should be allowed to post there...
function moderatorAdmin(message) {
  var channelName = rtm.dataStore.getChannelGroupOrDMById(message.channel).name;
  var channelCreatorId = rtm.dataStore.getChannelGroupOrDMById(message.channel).creator;
  var channelCreatorName = rtm.dataStore.getUserById(channelCreatorId).name;
  var messageUserId = message.user;
  var messageUserName = rtm.dataStore.getUserById(message.user).name;
  var dmRecipient = "@" + messageUserName;
  var messageUserIsAdmin = rtm.dataStore.getUserById(message.user).is_admin;
  var moderator;

  // fetching existing DB user from message if there is one, because they are allowed to add/remove others
  db.all("SELECT userid, channelid FROM channels \
          WHERE channelid = '" + message.channel + "' \
          AND userid = '" + message.user + "' LIMIT 1",function(err,row){
            if (row[0]) {
              moderator = row[0].userid;
            }
            if (err) {
              console.log('ERROR: ', err);
            }


    if (!(messageUserId == channelCreatorId || messageUserIsAdmin || moderator == message.user)) {
      console.log('User %s is not allowed to block channel %s', messageUserName, channelName);
      web.chat.postMessage(dmRecipient, "You are not allowed to choose an admin.", dmArgs, function () {});

      return;
    }

    if (!message.text.match(/^(<@[A-Z|0-9]+>:{0,1}\s(add|remove|list))/i)) {
      console.log('This is no valid moderator command: ', message.text);
      web.chat.postMessage(dmRecipient, "You've used a wrong bot command.\n Usage: @" + botUserName + " [add|remove] @user", dmArgs, function () {});
    } else {

      switch (message.text.match(/^<@[A-Z|0-9]+>:{0,1}\s(add|remove|list)/i)[1]) {

        case "add":
          var user = message.text.match(/add\s<{0,1}@{0,1}([A-Z|0-9|\_|\-|\.]+)>{0,1}\s{0,}$/i)[1];
          addModerator(user, message.channel, channelName);
          break;

        case "remove":
          var user = message.text.match(/remove\s<{0,1}@{0,1}([A-Z|0-9|\_|\-|\.]+)>{0,1}\s{0,}$/i)[1];
          removeModerator(user, message.channel, channelName);
          break;

        case "list":
          listModerators(message.channel);
          break;

        default:
          console.log('This is no valid moderator command: ', message.text);
          web.chat.postMessage(dmRecipient, "ou've used a wrong bot command.\n Usage: @" + botUserName + " [add|remove] @user", dmArgs, function () {});
          break;

      }

    }

  });
  return;
}



// is called if admin checks from function moderatorAdmin succeeded
function addModerator(userNameOrId, channelId, channelName) {
  var moderatorUserName = rtm.dataStore.getUserById(userNameOrId);


  // ugly complicated checks if a username or userid is passed to the function (both is possible)
  if (moderatorUserName === undefined || moderatorUserName === null) {
    moderatorUserName = userNameOrId;
    var moderatorUserId = rtm.dataStore.getUserByName(userNameOrId);

    if (moderatorUserId === undefined || moderatorUserId === null) {
      console.log('User %s not found in DB!', userNameOrId)
      web.chat.postMessage(channelId, "User " + userNameOrId + " does not exist in Slack.", dmArgs, function () {});
      return;
    } else {
      var moderatorUserId = moderatorUserId.id;
    }
  } else {
    moderatorUserName = moderatorUserName.name
    moderatorUserId = userNameOrId;
  }

  // we only want to insert a new moderator, if it not yet exists in db
  db.run("INSERT INTO channels (id, channelid, channelname, userid, username) \
            SELECT null, '" + channelId + "', '" + channelName + "', '" + moderatorUserId + "', '" + moderatorUserName + "' \
              WHERE NOT EXISTS \
              (SELECT 1 FROM channels WHERE channelid = '" + channelId + "' AND userid = '" + moderatorUserId + "')");

  listModerators(channelId);

  return;
}



// is called if admin checks from function moderatorAdmin succeeded
function removeModerator(userNameOrId, channelId) {
  var moderatorUserName = rtm.dataStore.getUserById(userNameOrId);

  // ugly complicated checks if a username or userid is passed to the function (both is possible)
  if (moderatorUserName === undefined || moderatorUserName === null) {
    var moderatorUserId = rtm.dataStore.getUserByName(userNameOrId);

    if (moderatorUserId === undefined || moderatorUserId === null) {
      console.log('User %s not found in DB!', userNameOrId)
      web.chat.postMessage(channelId, "User " + userNameOrId + " does not exist in Slack.", dmArgs, function () {});
      return;
    } else {
      var moderatorUserId = moderatorUserId.id;
    }
  } else {
    moderatorUserId = userNameOrId;
  }


  db.run("DELETE FROM channels WHERE userid = '" + moderatorUserId + "' AND channelid = '" + channelId + "'");

  listModerators(channelId);

  return;
}



function listModerators(channelId) {
  var moderators = '>>>';

  db.all("SELECT userid, username, channelid, channelname from channels \
           WHERE channelid = '" + channelId + "'",function(err,rows){
             if (err) {
               console.log(err);  
             }
             if (rows && rows != "") {
               // web.chat.postMessage(channelId, "LOG: \"" + rows + "\"", dmArgs, function () {});
               var channelName = rows[0].channelname;
               for (var i = 0; i < rows.length; i++) {
                 moderators = moderators + "@" + rows[i].username + "\n";

               }

               web.chat.postMessage(channelId, "*Admins in Channel " + channelName + ":*\n" + moderators, dmArgs, function () {});

             } else {
               web.chat.postMessage(channelId, 
               	                    "*At the moment only Channel Owner and Admins are allowed to post!*\n" + 
               	                    "> You can elect Admins via command: *@" + botUserName + " add @user*"
               	                    , dmArgs, function () {});
             }
  });

  return;
}


// deleting all kind of messages from non moderators/admins/channel creators
function messageAction(message) {
  var timestamp = message.ts;
  var messageUserId = message.user;

  if (message.subtype == 'file_share') {
    var messageUserName = rtm.dataStore.getUserById(message.file.user).name;
    var forwarderUserName = rtm.dataStore.getUserById(message.user).name;
  } else if (message.subtype == 'message_replied') {
    var messageUserName = rtm.dataStore.getUserById(message.user).name;
    var forwarderUserName = rtm.dataStore.getUserById(message.user).name;
  } else {
    var messageUserName = rtm.dataStore.getUserById(message.user).name;
  }

  var dmRecipient = "@" + messageUserName;
  var channelId = message.channel;
  var channelName = rtm.dataStore.getChannelGroupOrDMById(message.channel).name;
  var channelCreatorId = rtm.dataStore.getChannelGroupOrDMById(message.channel).creator;
  
  // If DM, there is no Channel Creator... (avoid exception, we do not delete DMs to bot...)
  if (!(channelCreatorId === undefined || channelCreatorId === null)) {
    var channelCreatorName = rtm.dataStore.getUserById(channelCreatorId).name;
  }
  var directMessage = rtm.dataStore.getDMByName(messageUserName);
  var messageUserIsAdmin = rtm.dataStore.getUserById(message.user).is_admin;
  var isModerator;

  // fetch moderator row, if the message poster is one
  db.all("SELECT userid, channelid from channels \
           WHERE userid = '" + messageUserId + "' \
           AND channelid = '" + channelId + "' LIMIT 1",function(err,row){
             if (err) {
               console.log(err);  
             }
             if (row[0]) {
               isModerator = true;
             }

  
    if (messageUserId == channelCreatorId || messageUserName == botUserName || isModerator || messageUserIsAdmin) {
      console.log('Message from admin, moderator or bot (%s), nothing to delete...', messageUserName);
      return;
    }
  
    console.log('Message to delete from User %s in channel %s: Text: %s User: %s Forwarder: %s', messageUserName, channelName, message.text, messageUserName, forwarderUserName);
    web.chat.delete(timestamp, channelId, function () {});

    if (message.subtype == 'file_share' && !forwarderUserName) {
      web.files.delete(message.file.id, function () {});
    }

    if (message.subtype == 'file_comment') {
      web['files.comments'].delete(message.file.id, message.comment.id, function () {});
      // web.files.comments.delete(message.file.id, message.comment.id, function () {}); --> a bug, currently not possible to call the propper way...
    }

    web.chat.postMessage(dmRecipient, 
                        "Hi <@" + messageUserName + 
                        ">, the Channel <#" + channelId + "|" + channelName + ">" +
                        " is read only for you.\n" +
                        "Channel Owner is <@" + channelCreatorName +
                        "> if you have any questions...", dmArgs, function () {});
  
  });

  return;
}



// this function is called when the bot is kicked from a channel or group (private channel)
function removeChannelFromDB(message) {
  var channelName = rtm.dataStore.getChannelGroupOrDMById(message.channel).name;
  var moderators;

  // fetching all moderators first, to be able to reproduce if kick was a mistake or unauthorized
  db.all("SELECT username, userid FROM channels \
          WHERE channelid = '" + message.channel + "'",function(err,rows) {
            if (rows) {
              for (var i = 0; i < rows.length; i++) {
                if (moderators === undefined) {
                  moderators = "<@" + rows[i].userid + "|" + rows[i].username + ">";
                } else {
                  moderators = moderators + ", <@" + rows[i].userid + "|" + rows[i].username + ">";
                }
              }
            }
            if (err) {
              console.log('ERROR: ', err);
            }

            if (moderators === undefined) {
              moderators = 'none, only Admins and Channel Creator at the moment';
            }

            // make sure that we can reproduce who was moderator of this channel
            console.log("Blockbot left channel: ", channelName);
            console.log('Left Channel %s had these moderators: ', channelName, moderators);
            web.chat.postMessage(message.channel, botUserName + " has left channel " + channelName + ". From now on everyone can post messages...", dmArgs, function () {});
            web.chat.postMessage(message.channel, "These members have been allowed to post: " + moderators, dmArgs, function () {});
  });

  db.run("DELETE FROM channels WHERE channelid = '" + message.channel + "'");

  return;
}