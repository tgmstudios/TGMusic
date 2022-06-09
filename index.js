//TGMusic

const Discord = require("discord.js");
const client = new Discord.Client();
const { mongo_host, mongo_port, mongo_user, mongo_pass, mongo_db, discord_default_prefix, discord_token, ksoft_api_key } = require("./config.json");
const ytdl = require("ytdl-core");
var request = require('request');
var validUrl = require('valid-url');
var search = require('youtube-search');
const { KSoftClient } = require('@ksoft/api');
const ksoft = new KSoftClient(ksoft_api_key);

const queue = new Map();

// guilds
var MongoClient = require('mongodb').MongoClient;
var url = `mongodb://${mongo_user}:${mongo_pass}@${mongo_host}:${mongo_port}/admin`;
var mongoDB;
MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true }, function(err, db) {
    if (err) throw err;
    mongoDB = db.db(mongo_db);
})

client.once("ready", () => {
    console.log("Ready!");
    client.user.setActivity("-help", {
        type: "LISTENING"
    });
});

client.once("reconnecting", () => {
    console.log("Reconnecting!");
});

client.once("disconnect", () => {
    console.log("Disconnect!");
});

client.on('voiceStateUpdate', async(oldState, newState) => {
    const guildQueue = queue.get(oldState.guild.id);
    if (oldState.member.id == client.user.id) {
        if (newState.connection == null) {
            if (!guildQueue) return;
            if (guildQueue.songs) guildQueue.songs = [];
            queue.delete(newState.guild.id);
        }
    } else if (oldState.channelID) {
        if (!oldState.channel.members) return;
        if (oldState.channel.members.size == 1 && oldState.channel.members.get(client.user.id)) {
            if (!guildQueue) return;
            guildQueue.textChannel.send(`>>> I left the channel because **the channel was empty**!`);
            guildQueue.songs = [];
            guildQueue.connection.dispatcher.end();
        }
    }
});

client.on("message", async message => {
    if (message.author.bot) return;
    let searchDBResult = await searchDB("guilds", { guildID: message.member.guild.id });
    var prefix, noSkip, noVol, allowEarrape;
    if (searchDBResult[0]) {
        prefix = searchDBResult[0].prefix;
        noSkip = searchDBResult[0].noSkip;
        noVol = searchDBResult[0].noVol;
        allowEarrape = searchDBResult[0].allowEarrape;
    } else {
        prefix = discord_default_prefix;
        noSkip = false;
        noVol = false;
        allowEarrape = true;
    }
    if (!message.content.startsWith(prefix) && message.content != "-help") return;
    const guildQueue = queue.get(message.guild.id);

    if (message.content.startsWith(`${prefix}play`)) {
        playEvent(guildQueue, message)
        return;
    } else if (message.content.startsWith(`${prefix}skip`)) {
        if (noSkip) return message.channel.send(`>>> **noSkip** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noSkip false**`)
        skip(guildQueue, message);
    } else if (message.content.startsWith(`${prefix}stop`)) {
        if (noSkip) return message.channel.send(`>>> **noSkip** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noSkip false**`)
        const perms = await checkPerms(message.member);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **skip** music!`)
            return;
        }
        if (!guildQueue) return message.channel.send(">>> There is **no song** that I could **skip**!");
        guildQueue.songs = [];
        guildQueue.connection.dispatcher.end();
        message.react('🛑');
        return;
    } else if (message.content.startsWith(`${prefix}pause`)) {
        if (noSkip) return message.channel.send(`>>> **noSkip** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noSkip false**`)
        const perms = await checkPerms(message.member);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **pause** music!`)
            return;
        }
        if (!guildQueue) return message.channel.send(">>> There is **no song** that I could **pause**!");
        guildQueue.connection.dispatcher.pause();
        message.react('✅');
    } else if (message.content.startsWith(`${prefix}resume`)) {
        const perms = await checkPerms(message.member);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **resume** music!`)
            return;
        }
        if (!guildQueue) return message.channel.send(">>> There is **no song** that I could **resume**!");
        message.react('✅');
        guildQueue.connection.dispatcher.resume();
    } else if (message.content.startsWith(`${prefix}volume`)) {
        if (noVol) return message.channel.send(`>>> **noVol** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noVol false**`)
        volume(guildQueue, message);
        return;
    } else if (message.content.startsWith(`${prefix}earrape`)) {
        if (!allowEarrape) return message.channel.send(`>>> **Earrape** is **Disabled** on this guild! To turn this off run **${prefix}guildSettings set allowEarrape true**`)
        const perms = await checkPerms(message.member);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **change volume**!`)
            return;
        }
        if (!guildQueue) return message.channel.send(">>> There is **no song** playing!");
        const args = message.content.split(` `);
        guildQueue.connection.dispatcher.setVolumeLogarithmic(100000 / 100);
        message.channel.send(`>>> Raising the volume, **just a little**.`);
    } else if (message.content.startsWith(`${prefix}lyrics`)) {
        if (message.content == `${prefix}lyrics`) {
            if (!guildQueue) return message.channel.send(">>> There is **no song** playing!");
            getlyrics(guildQueue.songs[0].title, message.channel);
            return;
        }
        const args = message.content.split(` `);
        var query = "";
        for (let i = 1; i < args.length; i++) {
            query += args[i] + " ";
        }
        getlyrics(query, message.channel);
        return;
    } else if (message.content == `${prefix}np`) {
        if (!guildQueue) return message.channel.send(">>> There is **no song** playing!");
        var song = guildQueue.songs[0];
        var time = Math.floor((new Date().getTime() / 1000) - guildQueue.songs[0].currentTime);
        var songTime = (Math.floor(song.time / 60 / 60)) + 'h ' + (Math.floor(song.time / 60) - (Math.floor(song.time / 60 / 60) * 60)) + 'm ' + (song.time % 60) + 's';
        var convTime = (Math.floor(time / 60 / 60)) + 'h ' + (Math.floor(time / 60) - (Math.floor(time / 60 / 60) * 60)) + 'm ' + (time % 60) + 's';
        const nowPlaying = new Discord.MessageEmbed()
            .setColor('#B6946E')
            .setAuthor('TGMusic - Bot by TGMstudios', 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png', 'https://www.tgmstudios.net')
            .setTitle('Now Playing:')
            .addFields({ name: "Song:", value: `[**${song.title}**](${song.url})`, inline: true }, { name: "Time:", value: `**${convTime}** / **${songTime}**`, inline: true }, )
            .setImage(song.thumbnail)
            .setTimestamp()
            .setFooter(`Song Requested By - ${song.requested} || TGMusic`, 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png');
        guildQueue.textChannel.send(nowPlaying);
        return;
    } else if (message.content.startsWith(`${prefix}queue`)) {
        queueSettings(guildQueue, message)
        return;
    }
    //Admin CMDs
    else if (message.content.startsWith(`${prefix}kick `)) {
        const perms = await checkAdminPerms(message.member.id, message.guild.id);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> Insufficient Permissions!`)
            if (perms.reason == 1) message.channel.send(`>>> I am not an **Admin**!`)
            return;
        }
        var member = message.mentions.members.first();
        member.kick().then((member) => {
            message.channel.send(`>>> **${member.displayName}** has been **kicked!**`);
        })
    } else if (message.content.startsWith(`${prefix}ban `)) {
        const perms = await checkAdminPerms(message.member.id, message.guild.id);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> Insufficient Permissions!`)
            if (perms.reason == 1) message.channel.send(`>>> I am not an **Admin**!`)
            return;
        }
        var member = message.mentions.members.first();
        member.ban().then((member) => {
            message.channel.send(`>>> **${member.displayName}** has been **banned**!`);
        })
    } else if (message.content.startsWith(`${prefix}purge `)) {
        const perms = await checkAdminPerms(message.member.id, message.guild.id);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> Insufficient Permissions!`)
            if (perms.reason == 1) message.channel.send(`>>> I am not an **Admin**!`)
            return;
        }
        const args = message.content.split(` `);
        if (!args[1]) return message.channel.send(">>> Please define the amount!");
        if (parseInt(args[1]) > 100 || parseInt(args[1]) <= 0) {
            message.channel.send(">>> Must be greater than **0** and less than **100**!");
            return;
        }
        message.channel.bulkDelete(args[1]);
        message.channel.send(`>>> Purged **${args[1]}** messages.`)
            .then(msg => {
                msg.delete({ timeout: 5000 })
            })
    } else if (message.content.startsWith(`${prefix}guildSettings`) || message.content.startsWith(`-guildSettings`)) {
        const perms = await checkAdminPerms(message.member.id, message.guild.id);
        if (perms.status != "success") {
            if (perms.reason == 0) message.channel.send(`>>> Insufficient Permissions!`)
            if (perms.reason == 1) message.channel.send(`>>> I am not an **Admin**!`)
            return;
        }
        guildSettings(message)
        return;
    }
    //aliases
    else if (message.content.startsWith(`${prefix}p `)) {
        playEvent(guildQueue, message)
        return;
    } else if (message.content.startsWith(`${prefix}v `)) {
        if (noVol) return message.channel.send(`>>> **noVol** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noVol false**`)
        volume(guildQueue, message);
        return;
    } else if (message.content == `${prefix}s`) {
        if (noSkip) return message.channel.send(`>>> **noSkip** is **Enabled** on this guild! To turn this off run **${prefix}guildSettings set noSkip false**`)
        skip(guildQueue, message);
        return;
    } else if (message.content.startsWith(`${prefix}q`)) {
        queueSettings(guildQueue, message)
        return;
    }
    //Help Menu
    else if (message.content.startsWith(`${prefix}help`) || message.content.startsWith(`-help`)) {
        const helpMenu = new Discord.MessageEmbed()
            .setColor('#B6946E')
            .setTitle('TGMusic')
            .setURL('https://www.tgmstudios.net/')
            .setAuthor('TGMusic - Bot by TGMstudios', 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png', 'https://www.tgmstudios.net')
            .setDescription('Custom music bot created by TGMstudios. This bot is currently in beta, if you have any problems email the developer at aiden@tgmstudios.net')
            .setThumbnail('https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png')
            .addFields({ name: `Help Menu (Current Prefix: ${prefix})`, value: 'Commands Include:' }, { name: `${prefix}help`, value: `Shows list of commands`, inline: true }, { name: `${prefix}play (song title)`, value: `Plays requested songs or adds song to queue`, inline: true }, { name: `${prefix}skip`, value: `Skips current song`, inline: true }, { name: `${prefix}stop`, value: `Emptys queue and disconnects bot from the voice server`, inline: true }, { name: `${prefix}pause`, value: `Pauses the song playing`, inline: true }, { name: `${prefix}resume`, value: `Resumes the song playing`, inline: true }, { name: `${prefix}volume (1/100)`, value: `Sets the volume of the song playing`, inline: true }, { name: `${prefix}earrape`, value: `No`, inline: true }, { name: `${prefix}lyrics (song title)`, value: `Searchs for the lyrics to the current playing song or searches for a song`, inline: true }, { name: `${prefix}queue`, value: `Replies with the queue`, inline: true }, { name: `${prefix}queue remove (song number in queue)`, value: `Removes a song from the queue`, inline: true }, { name: `\u200B`, value: `\u200B` }, { name: `Other Commands`, value: `Commands Include:`, inline: false }, { name: `${prefix}guildSettings [set, reset]`, value: `Change how the bot works on your server.`, inline: true }, { name: `${prefix}purge (1-100)`, value: `Deletes messages`, inline: true }, { name: `${prefix}kick (user)`, value: `Kicks a user`, inline: true }, { name: `${prefix}ban (user)`, value: `Bans a user`, inline: true }, { name: `\u200B`, value: `\u200B` }, { name: `Command Aliases`, value: `Aliases Include:`, inline: false }, { name: `${prefix}p`, value: `Alias for ${prefix}play`, inline: true }, { name: `${prefix}v`, value: `Alias for ${prefix}volume`, inline: true }, { name: `${prefix}s`, value: `Alias for ${prefix}skip`, inline: true }, { name: `${prefix}q`, value: `Alias for ${prefix}queue`, inline: true }, )
            .setTimestamp()
            .setFooter('aiden@tgmstudios.net || TGMusic', 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png');
        message.channel.send(helpMenu);
    }
});

async function playEvent(guildQueue, message) {
    const args = message.content.split(` `);
    const perms = await checkPerms(message.member);
    if (perms.status != "success") {
        if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **play music**!`)
        if (perms.reason == 1) message.channel.send(`>>> I need **Speak** & **Connect** permissions!`)
        return;
    }
    if (!args[1]) {
        if (!guildQueue) return message.channel.send(">>> There is **no song** that I could **resume**!");
        guildQueue.connection.dispatcher.resume();
        return;
    }
    var link;
    if (!validUrl.isUri(args[1])) {
        var query = "";
        for (let i = 1; i < args.length; i++) {
            query += args[i] + " ";
        }
        const results = await searchYouTube(query);
        if (!results[0] || !results[0].link) return message.channel.send(`>>> There was an **error** when we tried searching **${query}**!  Please send the link to the song instead!`)
        link = results[0].link;
    } else link = args[1];

    addQueue(guildQueue, message.member.user.username, message.channel, link, message.member.voice.channel, message.member.guild.id)
}
async function addQueue(guildQueue, userName, returnChannel, link, voiceChannel, guildID) {
    let songInfo;
    try {
        songInfo = await ytdl.getInfo(link, { downloadURL: true }, function(err, info) {
            if (err) console.log(err);
            console.log(info)
        });
    } catch (err) {
        returnChannel.send(`>>> There was an **error** when we tried **playing** your song!  Check your link and **try again** (**We cannot play age-restricted videos!**).  **If this keeps happening** please contact **aiden@tgmstudios.net** with your issue!`)
        console.log(err);
        return;
    }
    if (!songInfo || !songInfo.videoDetails || !songInfo.videoDetails.title) return returnChannel.send(`>>> There was an **error** when we tried **playing** your song!  Please contact **aiden@tgmstudios.net** with your issue!`)
    const song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url,
        thumbnail: `https://img.youtube.com/vi/${songInfo.videoDetails.videoId}/hqdefault.jpg`,
        requested: userName,
        time: songInfo.videoDetails.lengthSeconds,
        currentTime: null
    };
    if (!guildQueue) {
        const queueContruct = {
            textChannel: returnChannel,
            voiceChannel: voiceChannel,
            connection: null,
            songs: [],
            playing: true
        };
        queue.set(guildID, queueContruct);

        queueContruct.songs.push(song);

        try {
            queueContruct.connection = await voiceChannel.join();
            play(guildID, queueContruct.songs[0]);
        } catch (err) {
            console.log(err);
            queue.delete(guildID);
            return;
        }
    } else {
        guildQueue.songs.push(song);
        return returnChannel.send(`>>> **${song.title}** has been **added** to the **queue**!`);
    }
}
async function play(guildID, song) {
    const guildQueue = queue.get(guildID);
    if (!song) {
        guildQueue.voiceChannel.leave();
        queue.delete(guildID);
        return;
    }
    guildQueue.songs[0].currentTime = new Date().getTime() / 1000;

    const dispatcher = guildQueue.connection
        .play(await ytdl(song.url, { opusEncoded: true, type: 'opus' }))
        .on("finish", () => {
            guildQueue.songs.shift();
            play(guildID, guildQueue.songs[0]);
        })
        .on("error", error => console.error(error));

    dispatcher.setVolumeLogarithmic(35 / 100);
    const nowPlaying = new Discord.MessageEmbed()
        .setColor('#B6946E')
        .setAuthor('TGMusic - Bot by TGMstudios', 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png', 'https://www.tgmstudios.net')
        .setTitle('Now Playing:')
        .addFields({ name: "Song:", value: `[**${song.title}**](${song.url})`, inline: true }, )
        .setImage(song.thumbnail)
        .setTimestamp()
        .setFooter(`Song Requested By - ${song.requested} || TGMusic`, 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png');
    guildQueue.textChannel.send(nowPlaying);
}

const searchYouTube = async(query) => {
    return new Promise(async(resolve, reject) => {
        search(query, { maxResults: 1, key: 'AIzaSyDuP9ybP_zBcRMs-yoJNjjK_jEBZxlKUdc' }, function(err, results) {
            if (err) {
                //reject();
                resolve(err);
                console.log(err);
            }
            resolve(results);
        });
    });
}
const checkPerms = async(member) => {
    return new Promise(async(resolve, reject) => {
        if (!member.voice.channel)
            resolve(JSON.parse(`{"status": "error", "reason": "0"}`));
        else if (!member.voice.channel.permissionsFor(client.user).has("CONNECT") || !member.voice.channel.permissionsFor(client.user).has("SPEAK")) {
            resolve(JSON.parse(`{"status": "error", "reason": "1"}`));
        } else resolve(JSON.parse(`{"status": "success"}`));
    })
}
const checkAdminPerms = async(memberID, guildID) => {
    return new Promise(async(resolve, reject) => {
        var guild = client.guilds.cache.get(guildID);
        var guildMember = guild.members.cache.get(memberID);
        var guildClient = guild.members.cache.get(client.user.id);
        if (!guildMember.hasPermission("ADMINISTRATOR"))
            resolve(JSON.parse(`{"status": "error", "reason": "0"}`));
        else if (!guildClient.hasPermission("ADMINISTRATOR")) {
            resolve(JSON.parse(`{"status": "error", "reason": "1"}`));
        } else resolve(JSON.parse(`{"status": "success"}`));
    })
}

async function volume(guildQueue, message) {
    const perms = await checkPerms(message.member);
    if (perms.status != "success") {
        if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **change volume**!`)
        return;
    }
    if (!guildQueue || !guildQueue.songs) return message.channel.send(">>> There is no song playing!");
    const args = message.content.split(` `);
    if (!(args[1] <= 100) || !(args[1] >= 1)) return message.channel.send(">>> Please choose a **volume** between **1** and **100**!");
    guildQueue.connection.dispatcher.setVolumeLogarithmic(args[1] / 100);
    message.channel.send(`>>> **Volume** set to **${args[1]}**!`);
}
async function skip(guildQueue, message) {
    const perms = await checkPerms(message.member);
    if (perms.status != "success") {
        if (perms.reason == 0) message.channel.send(`>>> You need to be in a **voice channel** to **skip songs**!`)
        return;
    }
    if (!guildQueue) return message.channel.send(">>> There is **no song** that I could **skip**!");
    message.react('🛑');
    guildQueue.connection.dispatcher.end();
}
async function getlyrics(rawQuery, returnChannel) {
    query = rawQuery.replace(/[^a-zA-Z ]/g, '').replace(/Official Music Video/g, '').replace(/OFFICIAL MUSIC VIDEO/g, '').replace(/Official Audio/g, '').replace(/OFFICIAL AUDIO/g, '');
    var result = await ksoft.lyrics.get(query);
    var lyrics = result.lyrics;
    var parts = 1;
    for (var split = 0; split <= lyrics.length; split + 2000) {
        if (parts == 1) {
            const embedlyrics = new Discord.MessageEmbed()
                .setColor('#B6946E')
                .setAuthor('TGMusic - Bot by TGMstudios', 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png', 'https://www.tgmstudios.net')
                .setTitle(`Lyrics for ${result.name} - ${result.artist["name"]}`)
                .setDescription(`${lyrics.slice(split, parseInt(split + 2000))}`)
                .setFooter(`Part ${parts} || Lyrics from Ksoft.si || TGMusic`, 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png');
            returnChannel.send(embedlyrics);
        } else {
            const embedlyrics = new Discord.MessageEmbed()
                .setColor('#B6946E')
                .setDescription(`${lyrics.slice(split, parseInt(split + 2000))}`)
                .setFooter(`Part ${parts} || Lyrics from Ksoft.si || TGMusic `, 'https://downloads.tgmstudios.net/icons/discord-bots/TGMusic.png');
            returnChannel.send(embedlyrics);
        }
        split = parseInt(split + 2000);
        parts = parts + 1;
    }
}
async function queueSettings(guildQueue, message) {
    const args = message.content.split(` `);
    if (!args[1]) {
        if (!guildQueue || !guildQueue.songs) return message.channel.send(">>> There are **no songs** in the **queue**!");
        var returnMessage = "";
        for (let i = 0; i < guildQueue.songs.length; i++) {
            returnMessage += (`[${i}] \n  Title: ${guildQueue.songs[i].title}\n  URL: ${guildQueue.songs[i].url}\n  Requested By: ${guildQueue.songs[i].requested}\n`)
        }
        for (var split = 0; split <= returnMessage.length; split + 1990) {
            message.channel.send("```" + returnMessage.slice(split, parseInt(split + 1990)) + "```");
            split = parseInt(split + 1990);
        }
    }
    if (args[1] == "remove") {
        if (!guildQueue || !guildQueue.songs) return message.channel.send(">>> There are **no songs** in the **queue**!");
        if (!args[2] || !guildQueue.songs[args[2]] || args[2] == 0 || args[2] > guildQueue.songs.length || isNaN(args[2])) return message.channel.send(">>> Please specify the **number** of a **song** in the **queue**!");
        message.channel.send(`>>> **Removed**, **${guildQueue.songs[args[2]].title}** from the queue!`);
        guildQueue.songs.splice(args[2], args[2]);
    }
}
async function guildSettings(message) {
    let searchDBResult = await searchDB("guilds", { guildID: message.member.guild.id });
    if (!searchDBResult[0]) {
        addDB("guilds", { guildID: message.member.guild.id, prefix: "-", noSkip: false, noVol: false, allowEarrape: true });
        return message.channel.send(`>>> Guild Settings for **${message.member.guild.name}** created!  Please **run this command again** to continue!`)
    }
    const args = message.content.split(` `);
    if (!args[1]) {
        message.channel.send(`>>> [guildID: **${searchDBResult[0].guildID}**] \n      Prefix: **${searchDBResult[0].prefix}** \n      noVol: **${searchDBResult[0].noVol}** \n      noSkip: **${searchDBResult[0].noSkip}** \n      allowEarrape: **${searchDBResult[0].allowEarrape}**`);
    }
    if (args[1] == "set") {
        if (args[2] == "prefix") {
            modifyDB("guilds", { guildID: searchDBResult[0].guildID }, { $set: { guildID: searchDBResult[0].guildID, prefix: args[3], noVol: searchDBResult[0].noVol, noSkip: searchDBResult[0].noSkip, allowEarrape: searchDBResult[0].allowEarrape } });
            message.channel.send(`>>> **Set** the **prefix** to **${args[3]}**!`);
        } else if (args[2] == "noVol") {
            if (args[3] == "true") args[3] = true
            if (args[3] == "false") args[3] = false
            modifyDB("guilds", { guildID: searchDBResult[0].guildID }, { $set: { guildID: searchDBResult[0].guildID, prefix: searchDBResult[0].prefix, noVol: args[3], noSkip: searchDBResult[0].noSkip, allowEarrape: searchDBResult[0].allowEarrape } });
            message.channel.send(`>>> **Set** **noVol** to **${args[3]}**!`);
        } else if (args[2] == "noSkip") {
            if (args[3] == "true") args[3] = true
            if (args[3] == "false") args[3] = false
            modifyDB("guilds", { guildID: searchDBResult[0].guildID }, { $set: { guildID: searchDBResult[0].guildID, prefix: searchDBResult[0].prefix, noVol: searchDBResult[0].noVol, noSkip: args[3], allowEarrape: searchDBResult[0].allowEarrape } });
            message.channel.send(`>>> **Set** **noSkip** to **${args[3]}**!`);
        } else if (args[2] == "allowEarrape") {
            if (args[3] == "true") args[3] = true
            if (args[3] == "false") args[3] = false
            modifyDB("guilds", { guildID: searchDBResult[0].guildID }, { $set: { guildID: searchDBResult[0].guildID, prefix: searchDBResult[0].prefix, noVol: searchDBResult[0].noVol, noSkip: searchDBResult[0].noSkip, allowEarrape: args[3] } });
            message.channel.send(`>>> **Set** **allowEarrape** to **${args[3]}**!`);
        }
    } else if (args[1] == "reset") {
        if (!args[2]) return message.channel.send(`>>> Please confirm that you would like to reset your guilds **custom settings**!  Use **-guildSettings reset confirm**`);
        if (args[2] == "confirm") {
            deleteDB("guilds", { guildID: message.member.guild.id })
            message.channel.send(`>>> **Guild Settings** have been **reset**!`);
        }
    }
}

//mongo
const searchDB = async(collection, query) => {
    return new Promise((resolve, reject) => {
        mongoDB.collection(collection).find(query).toArray(function(err, result) {
            if (err) throw err;
            resolve(result);
        })
    })
}
async function deleteDB(collection, query) {
    mongoDB.collection(collection).deleteOne(query, function(err, obj) {
        if (err) throw err;
    });
}
async function addDB(collection, query) {
    mongoDB.collection(collection).insertOne(query, function(err, res) {
        if (err) throw err;
    });
}
async function modifyDB(collection, query, modify) {
    mongoDB.collection(collection).updateOne(query, modify, function(err, res) {
        if (err) throw err;
    });
}

client.login(discord_token);