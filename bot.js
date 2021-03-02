'use strict';

const crypto = require('crypto');
const Discord = require('discord.js');
const sgMail = require('@sendgrid/mail');
const auth = require ('./auth.json');
const client = new Discord.Client();

const OTP_BYTES = 4;
const EXPIRY_HOURS = 1;

function newClientData() {
    return {
        server: {},
        users: {},
    };
}
const clientData = newClientData();

sgMail.setApiKey(auth.sendgrid_token);
client.login(auth.discord_token);

async function sendOtp(user) {
    await user.send('Hi there! Please reply with your Unimelb student username.');
    clientData.users[user.username] = {
        hasCode: false,
        verified: false,
    };
}

async function handleReaction(user) {
    try {
        if (user.username !== client.user.username) {
            await sendOtp(user);
        }
    } catch (err) {
        console.log(`Error in reaction handler for ${user.username}:`);
        console.error(err);
    }
}

async function handleReply(msg) {
    if (msg.author.username in clientData.users) {
        const user = clientData.users[msg.author.username];
        if (!user.hasCode) {
            const username = msg.content;
            let email = `${username}@student.unimelb.edu.au`;
            // Check if the user mistakenly entered an email address
            if (username.includes('@')) {
                // Check that the user was on the unimelb domain
                if (username.endsWith('unimelb.edu.au') && !username.includes(' ')) {
                    email = username;
                } else {
                    await msg.author.send('You can only verify with a Unimelb email address. Please try again.');
                    return;
                }
            }

            // Generate a new code for the user and email it
            const otp = crypto.randomBytes(OTP_BYTES).toString('hex').toUpperCase();
            // 1 hour expiry
            const expiry = new Date(new Date().getTime() + EXPIRY_HOURS * (60*60*1000));

            user.otp = otp;
            user.expiry = expiry;
            user.username = username;
            console.log(`New OTP for ${user.username} (${username}): ${otp} (expires ${expiry})`);
            
            await emailUser(email, otp);
            await msg.author.send(`You will receive a one-time password at your student address \`${email}\` soon. Please reply with the password.`);
            user.hasCode = true;
        } else if (!user.verified) {
            // Check the code
            const claimedOtp = msg.content.trim().toUpperCase();
            if (new Date() < user.expiry) {
                if (claimedOtp === user.otp) {
                    await verifyUser(msg.author);
                    user.verified = true;
                } else {
                    await msg.author.send(`Code incorrect. Please try again; it was sent to \`${user.username}@student.unimelb.edu.au\`. If this is incorrect, tell the bot to send the original message again.`);
                }
            } else {
                await msg.author.send(`Your code has expired. Sending a new code to $\`{user.username}@student.unimelb.edu.au\`.`);
                user.hasCode = false;
                await handleReply(msg);
            }
        }
    } else {
        await handleReaction(msg.author);
    }
}

async function emailUser(email, otp) {
    const msg = {
        to: email,
        from: 'eleanor.mcmurtry@unimelb.edu.au',
        subject: `Your OTP for your subject's Discord Server`,
        text: `Your one-time password is: ${otp}\n\nPlease reply to the bot with this code.`,
    };
    try {
        await sgMail.send(msg);
    } catch (error) {
        console.error('Error sending email:');
        console.error(error);
        if (error.response) {
            console.error(error.response.body);
        }
    }
}

async function verifyUser(user) {
    try {
        await user.send(`Thanks! You've been verified and can now participate.`);
        for (const server of clientData.servers) {
            const role = await server.roles.cache.find(role => role.name === 'Verified');
            await server.member(user).roles.add(role);
        }
        console.log(`Verifying ${user.username}.`);
    } catch (err) {
        console.error('Error verifying user:');
        console.error(err);
    }
}

client.on('message', msg => {
    if (msg.channel.type === 'dm') {
        (async () => {
            try {
                await handleReply(msg);
            } catch (err) {
                console.error('Error in reply handler:');
                console.error(err);
            }
        })();
    }
});

client.on('ready', _ => {
    (async () => {
        try {
            clientData.servers = client.guilds.cache.array();
            const channels = client.channels.cache.filter(channel => channel.name === 'welcome');
            const messages = channels.map(c => c.send(`Welcome to the Discord channel! You'll need to verify your Unimelb account to start participating. React to this message (:+1:) and this bot will send you a direct message. Reply with your student username to get a verification code. If you need the message re-sent, click the :+1: reaction twice to undo and redo it.`));
            for (let msg of messages) {
                msg = await msg;
                msg.react('👍');
                msg.createReactionCollector(() => true).on('collect', (_, user) => {
                    (async () => {
                        await handleReaction(user);
                    })();
                });
            }

            console.log('Ready.');

        } catch (err) {
            console.log('Error in initialisation:');
            console.error(err);
        }

    })();
});
