#!/usr/bin/env nodejs
///////////////////////////////////////////////////////////////////////////
//    Copyright (C) 2019 Wizardry and Steamworks - License: CC BY 2.0    //
///////////////////////////////////////////////////////////////////////////

const mqtt = require('mqtt')
const YAML = require('yamljs')
const { createLogger, format, transports } = require('winston')
const Discord = require('discord.js')
const discordClient = new Discord.Client()
const qs = require('qs')
const path = require('path')
const fs = require('fs')

var discordChannelID = -1

// Regex that determines whether a SecondLife group message is a message
// that has been relayed by Corrade to the SecondLife group.
const groupDiscordRegex = new RegExp(/^.+?#[0-9]+? \[Discord\]:.+?$/gm)

// Load configuration file.
const config = YAML.load('config.yml')

// Set up logger.
const logger = createLogger({
    format: format.combine(
        format.splat(),
        format.simple()
    ),
    transports: [
        new transports.Console({
            timestamp: true
        }),
        new transports.File(
            {
                timestamp: true,
                filename: path.join(path.dirname(fs.realpathSync(__filename)), "log/corrade-group-discord-bridge.log")
            }
        )
    ]
})

// Subscribe to Corrade MQTT.
const mqttClient = mqtt.connect(config.corrade.mqtt)

mqttClient.on('reconnect', () => {
    logger.info('Reconnecting to Corrade MQTT server...')
})

mqttClient.on('connect', () => {
    logger.info('Connected to Corrade MQTT server.')
    // Subscribe to group message notifications with group name and password.
    mqttClient.subscribe(`${config.corrade.group}/${config.corrade.password}/group`, (error) => {
        if (error) {
            logger.info('Error subscribing to Corrade MQTT group messages.')
            return
        }

        logger.info('Subscribed to Corrade MQTT group messages.')
    })
})

mqttClient.on('error', (error) => {
    logger.error(`Error found while connecting to Corrade MQTT: ${error}`)
})

mqttClient.on('message', (topic, message) => {
    // If the Discord channel is not yet known then do not process the notification.
    if (discordChannelID === -1) {
        logger.error('Message received from Corrade but Discord channel could not be retrieved.')
        return
    }
    

    // Make an object out of the notification.
    let notification = qs.parse(message.toString())

    // Check the notification parameters for sanity.
    if (typeof notification.type === 'undefined' ||
        notification.type !== 'group')
        return

    if (notification.group.toUpperCase() !==
        config.corrade.group.toUpperCase())
        return

    // If this is a message relayed by Corrade to Discord, then ignore 
    // the message to prevent echoing the message multiple times.
    if (notification.message.match(groupDiscordRegex))
        return
        
    // Send the message to the channel.
    discordClient
        .channels
        .get(discordChannelID)
        .send(`${notification.firstname} ${notification.lastname} [SL]: ${notification.message}`)
})

discordClient.on('message', (message) => {
    // For Discord, ignore messages from bots (including self).
    if (message.author.bot)
        return

    let messageContent = message.content
    if (message.attachments.length !== 0)
        message.attachments.forEach(attachment => messageContent = `${messageContent} ${attachment.url}`)

    // Ignore empty messages.
    if (messageContent.length == 0)
        return

    // Ignore messages that are not from the configured channel.
    if (message.channel.id !== discordChannelID)
        return

    // Check if this is the intended server.
    if (message.channel.guild.name !== config.discord.server)
        return

    // Discard anything but text messages.
    if (message.channel.type !== 'text')
        return

    // If the message contains the special prefix then pass the message
    // as it is without prefixing it with the Discord username.
    // TODO: security, fix me!
    let reply = `${message.author.username}#${message.author.discriminator} [Discord]: ${messageContent}`

    // Build the tell command.
    const corradeCommand = qs.stringify({
        'command': 'tell',
        'group': config.corrade.group,
        'password': config.corrade.password,
        'entity': 'group',
        'message': reply
    })

    mqttClient.publish(`${config.corrade.group}/${config.corrade.password}/group`, corradeCommand)
})

// Retrieve channel ID when Discord is ready.
discordClient.on('ready', () => {
    logger.info('Connected to Discord.')
        
    const channel = discordClient
        .channels
        .find(channel => channel.name === config.discord.channel &&
                channel.guild.name === config.discord.server)

    if (typeof channel === 'undefined' || channel == null) {
        logger.error('The channel could not be found on discord.')
        return
    }

    logger.info('Discord channel ID retrieved successfully.')
    discordChannelID = channel.id
})

discordClient.on('error', (error) => {
    logger.error(`Error occurred whilst connecting to Discord: ${error}`)
})

discordClient.on('reconnecting', () => {
    logger.error('Reconnecting to Discord...')
})

// Login to discord.
discordClient.login(config.discord.botKey)
    .then(() => {
        logger.info('Logged-in to Discord.')
    })
    .catch((error) => {
        logger.error('Failed to login to Discord.')
    });
