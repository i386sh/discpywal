const { Client, Events, GatewayIntentBits } = require('discord.js'),
    fac = require('fast-average-color-node'),
    SQLite = require("better-sqlite3"),
    config = require("./config.json");

const sql = new SQLite("./db.sqlite");
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

let updates = 0;

// Clamp
const clamp = (num, min, max) => Math.min(Math.max(num, min), max);

// Colour conversion functions
const HSLToRGB = (h, s, l) => {
    s /= 100;
    l /= 100;
    const k = n => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = n =>
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
};

const RGBToHEX = (r, g, b) => '#' + [r, g, b]
    .map(x => x.toString(16).padStart(2, '0')).join('')

const RGBToHSL = (r, g, b) => {
    r /= 255;
    g /= 255;
    b /= 255;
    const l = Math.max(r, g, b);
    const s = l - Math.min(r, g, b);
    const h = s ?
        l === r ?
        (g - b) / s :
        l === g ?
        2 + (b - r) / s :
        4 + (r - g) / s :
        0;
    return [
        60 * h < 0 ? 60 * h + 360 : 60 * h,
        100 * (s ? (l <= 0.5 ? s / (2 * l - s) : s / (2 - (2 * l - s))) : 0),
        (100 * (2 * l - s)) / 2,
    ];
};

client.once(Events.ClientReady, c => {
    console.log(`Ready! Logged in as ${c.user.tag}`);

    const rndStatus = config.statusList[Math.floor(Math.random() * config.statusList.length)];
    client.user.setPresence({
        activities: [{
            name: rndStatus.name,
            type: rndStatus.type
        }],
        status: 'dnd'
    });

    // Database setup.
    const table = sql.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'users';").get();
    if (!table['count(*)']) {
        sql.prepare("CREATE TABLE users (user TEXT PRIMARY KEY, multiplier INTEGER);").run();
        sql.pragma("synchronous = 1");
        sql.pragma("journal_mode = wal");
    }

    client.getConfig = sql.prepare("SELECT * FROM users WHERE user = ?");
    client.setConfig = sql.prepare("INSERT OR REPLACE INTO users (user, multiplier) VALUES (@user, @multiplier);")
});

client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.content.indexOf(config.prefix) !== 0) return;

    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    const command = args.shift().toLowerCase();

    let configs = client.getConfig.get(message.author.id);

    if (!configs) {
        configs = {
            user: message.author.id,
            multiplier: 1
        }
    }

    switch (command) {
        // I'm not documenting what all of these do, you can figure it out.
        case "update":
            fac.getAverageColor(message.author.avatarURL()).then(col => {
                let conv_toHSL = RGBToHSL(col.value[0], col.value[1], col.value[2]);
                conv_toHSL[1] = clamp(conv_toHSL[1] * configs.multiplier, 0, conv_toHSL[2] > 49 ? 100 : 50);
                let conv_toRGB = HSLToRGB(conv_toHSL[0], conv_toHSL[1], conv_toHSL[2]);
                let conv_toHEX = RGBToHEX(Math.round(conv_toRGB[0]), Math.round(conv_toRGB[1]), Math.round(conv_toRGB[2]));

                let _role = message.guild.roles.cache.find(role => role.name == message.author.id)
                if (_role) {
                    _role.edit({
                        color: conv_toHEX
                    });
                    message.reply("✅ Colour updated.");
                } else {
                    message.reply("❌ You don't have a discpywal role setup.");
                }
            });
            break;
        case "create":
            fac.getAverageColor(message.author.avatarURL()).then(col => {
                let _role = message.guild.roles.cache.find(role => role.name == message.author.id)
                if (!_role) {
                    message.guild.roles.create({
                        name: message.author.id,
                        color: col.hex
                    }).then((role) => {
                        message.member.roles.add(role);
                        message.reply("✅ discpywal role created. You may need to move it above other colour roles.");
                    });
                } else {
                    message.reply("❌ You already have a discpywal role.");
                }
            });
            break;
        case "config":
            if (args[0] == "multiplier") {
                if (args[1] && !isNaN(args[1])) {
                    if (args[1] < 0.3) return message.reply("❌ The specified multiplier is below 0.3.");
                    if (args[1] > 5) return message.reply("❌ The specified multiplier is above 5.");
                    configs.multiplier = args[1];
                    client.setConfig.run(configs);
                    message.reply("✅ Saturation multiplier changed.");
                } else {
                    return message.reply("❌ You are missing an argument, or the argument is not a number.");
                }
            } else if (args[0] == "show") {
                message.reply("```\ncurrent multiplier: " + configs.multiplier + "```");
            } else {
                message.reply("❌ You need to specify a subcommand [show, multiplier].");
            }
            break;
        case "remove":
            let _role = message.guild.roles.cache.find(role => role.name == message.author.id)
            if (_role) {
                _role.delete();
                message.reply("✅ discpywal role deleted.");
            } else {
                message.reply("❌ You don't have a discpywal role setup.");
            }
            break;
        case "help":
            // I don't want to force the prefix to _forever_ be pywal so fuck you, take your dynamic help bullshit. Well.. dynamic-ish I guess.
            let commandList = [{
                name: "create",
                description: "creates a role with your user ID for discpywal"
            }, {
                name: "remove",
                description: "delete the role with your user ID"
            }, {
                name: "update",
                description: "force update your discpywal role in the server"
            }, {
                name: "config show",
                description: "show discpywal configuration"
            }, {
                name: "config multiplier <num between 0.3 and 5>",
                description: "set saturation multiplier"
            }]
            let finalOutput = "```\n-> command prefix: " + config.prefix + "\n-> commands:\n";
            commandList.forEach(x => {
                finalOutput = finalOutput + "  -> " + x.name + " / " + x.description + "\n"
            })
            message.reply(finalOutput + "```");
            break;
    }
});

client.on("userUpdate", async (userO, userN) => {
    if (updates == 8) {
        const rndStatus = config.statusList[Math.floor(Math.random() * config.statusList.length)];
        client.user.setPresence({
            activities: [{
                name: rndStatus.name,
                type: rndStatus.type
            }],
            status: 'dnd'
        });
        updates = 0;
    } else updates = updates + 1;

    let filtered = client.guilds.cache.filter(guild => !!guild.members.fetch(userN));
    let configs = client.getConfig.get(userN.id);
    if (!configs) {
        configs = {
            user: userN.id,
            multiplier: 1
        }
    }

    fac.getAverageColor(userN.avatarURL()).then(col => {
        let conv_toHSL = RGBToHSL(col.value[0], col.value[1], col.value[2]);
        conv_toHSL[1] = clamp(conv_toHSL[1] * configs.multiplier, 0, conv_toHSL[2] > 49 ? 100 : 50);
        let conv_toRGB = HSLToRGB(conv_toHSL[0], conv_toHSL[1], conv_toHSL[2]);
        let conv_toHEX = RGBToHEX(Math.round(conv_toRGB[0]), Math.round(conv_toRGB[1]), Math.round(conv_toRGB[2]));

        filtered.forEach((c) => {
            let _role = c.roles.cache.find(role => role.name == userN.id)
            if (_role) {
                _role.edit({
                    color: conv_toHEX
                });
            }
        })
    });
});

client.login(config.token);
