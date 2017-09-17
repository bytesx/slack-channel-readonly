Slack Bot invited to a public channel will delete all new messages from users other than the channel creator or Slack Admins.
Slack Admins and channel creator are allowed to elect other members for posting in the channel.
Elevated members are stored in a local sqlite database per channel.

- Uses Node.js with node-slack-sdk
    https://github.com/slackhq/node-slack-sdk
- Requires a Slack Bot Token and a Web API Dev "Test" Token (which is a legacy approach in Slack, better you provision a slack app now)
- Does not require any Slack webhooks and may be run as a client in private environment with usual internet connection...


Installing node-slack-sdk:
===========================
```
npm install @slack/client --save

Requires recent version of npm

sudo npm install -g npm

user@tux ~ $ npm -v
3.10.5
```


Docker Image Information:
==========================
Build the image:
```
docker build -t slack-blockbot .
```


Run the Image:
===============
```
docker run -d --name slack-blockbot --restart=always --env-file ~/.env -v /docker/persistent-data/blockbot/blockbot.sqlite3:/blockbot/data/blockbot.sqlite3 -it slack-blockbot
```