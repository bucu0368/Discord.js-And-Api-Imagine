const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const express = require('express');
const fs = require('fs');
const config = require('./config.json');

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMembers]
});

// Initialize Express app
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIzaSyDYrzBFmFiD39OrARGPKaDhqv9XsUaxlWw");
const app = express();

// API Configuration
const VALID_API_KEY = process.env.API_KEY || "bucu";
const port = process.env.PORT || "6207";

// API keys storage for Discord bot
const apiKeysFile = 'apikeys.json';
let apiKeys = {};

// Load existing API keys
if (fs.existsSync(apiKeysFile)) {
  try {
    apiKeys = JSON.parse(fs.readFileSync(apiKeysFile, 'utf8'));
  } catch (error) {
    console.error('Error loading API keys:', error);
    apiKeys = {};
  }
}

// Save API keys to file
function saveApiKeys() {
  try {
    fs.writeFileSync(apiKeysFile, JSON.stringify(apiKeys, null, 2));
  } catch (error) {
    console.error('Error saving API keys:', error);
  }
}

// Generate random API key
function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 23; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `Apikey-${result}`;
}

// Check if user is owner
function isOwner(userId) {
  return userId === config.owner;
}

// Middleware to track request timing
function trackRequestTime(req, res, next) {
  req.startTime = Date.now();
  next();
}

// Middleware to verify API key for Express routes
function verifyApiKey(req, res, next) {
  const apikey = req.query.apikey || req.headers['x-api-key'];

  if (!apikey) {
    return res.status(401).json({
      error: "API key required for authentication",
      message: "Provide apikey as query parameter or x-api-key header"
    });
  }

  // Check against both default API key and Discord generated keys
  if (apikey === VALID_API_KEY) {
    return next();
  }

  // Check against Discord generated API keys
  let validKey = false;
  for (const userData of Object.values(apiKeys)) {
    if (userData.keys && userData.keys.some(keyData => keyData.key === apikey)) {
      validKey = true;
      break;
    }
  }

  if (!validKey) {
    return res.status(401).json({
      error: "Invalid or expired api key."
    });
  }

  next();
}

async function generateImage(prompt) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    generationConfig: {
      responseModalities: ["Text", "Image"]
    }
  });

  try {
    const response = await model.generateContent(prompt);

    for (const part of response.response.candidates[0].content.parts) {
      if (part.inlineData) {
        return part.inlineData.data; // Return base64 image data
      }
    }

    throw new Error("No image generated");
  } catch (error) {
    console.error("Error generating content:", error);
    throw error;
  }
}

// Store generated images in memory with unique IDs
const imageCache = new Map();

// Express Routes
app.get('/image', trackRequestTime, verifyApiKey, async (req, res) => {
  try {
    const prompt = req.query.prompt;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt parameter is required" });
    }

    const imageData = await generateImage(prompt);

    // Generate unique ID for the image
    const imageId = Date.now() + '-' + Math.random().toString(36).substring(2);

    // Store image data in cache
    imageCache.set(imageId, imageData);

    // Calculate request duration
    const endTime = Date.now();
    const duration = ((endTime - req.startTime) / 1000).toFixed(2);

    // Return JSON with image URL
    const imageUrl = `${req.protocol}://${req.get('host')}/generated/${imageId}.png`;

    res.json({
      message: 'Image generated successfully',
      status: 'success',
      imageId: imageId,
      image: imageUrl,
      prompt: prompt,
      duration: `${duration}s`
    });

  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - req.startTime) / 1000).toFixed(2);
    res.status(500).json({ 
      error: "Failed to generate image",
      duration: `${duration}s`
    });
  }
});

// Endpoint to serve generated images
app.get('/generated/:imageId.png', (req, res) => {
  const imageId = req.params.imageId;
  const imageData = imageCache.get(imageId);

  if (!imageData) {
    return res.status(404).json({ error: "Image not found" });
  }

  const imageBuffer = Buffer.from(imageData, 'base64');

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': imageBuffer.length
  });

  res.send(imageBuffer);
});

// Discord Bot Events
client.once('ready', async () => {
  console.log(`Bot logged in as ${client.user.tag}`);

  // Set bot status and activity
client.user.setStatus(config.status);
client.user.setActivity(config.activity);

  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('apikey')
      .setDescription('API key management')
      .addSubcommand(subcommand =>
        subcommand
          .setName('generate')
          .setDescription('Generate a new API key for yourself')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('list')
          .setDescription('List all API keys (Owner only)')
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('remove')
          .setDescription('Remove an API key (Owner only)')
          .addStringOption(option =>
            option.setName('apikey')
              .setDescription('The API key to remove')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('status')
          .setDescription('Check API key status')
          .addStringOption(option =>
            option.setName('apikey')
              .setDescription('The API key to check')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('add')
          .setDescription('Add API key for a user (Owner only)')
          .addUserOption(option =>
            option.setName('user')
              .setDescription('User to add API key for')
              .setRequired(true)
          )
          .addStringOption(option =>
            option.setName('reason')
              .setDescription('Reason for adding API key')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('auto-remove')
          .setDescription('Toggle auto-removal of API keys when users leave server (Owner only)')
          .addBooleanOption(option =>
            option.setName('enabled')
              .setDescription('Enable or disable auto-removal')
              .setRequired(true)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('show')
          .setDescription('Show your own API keys')
      )
  ];

  try {
    await client.application.commands.set(commands);
    console.log('Slash commands registered successfully');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  if (commandName === 'apikey') {
    const subcommand = options.getSubcommand();
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTimestamp();

    switch (subcommand) {
      case 'generate':
        // Check if command is used in allowed channel
        if (config.allowedChannel && interaction.channelId !== config.allowedChannel) {
          embed.setTitle('❌ Command Not Allowed Here')
            .setDescription('This command can only be used in the designated channel.');
          return interaction.reply({ embeds: [embed] });
        }

        if (!apiKeys[userId]) {
          apiKeys[userId] = { keys: [], count: 0 };
        }

        if (apiKeys[userId].count >= 3) {
          embed.setTitle('❌ API Key Generation Failed')
            .setDescription('You have reached the maximum limit of 3 API keys per user.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const newApiKey = generateApiKey(username);
        apiKeys[userId].keys.push({
          key: newApiKey,
          createdAt: new Date().toISOString(),
          username: username
        });
        apiKeys[userId].count++;
        saveApiKeys();

        embed.setTitle('✅ API Key Generated')
          .setDescription('Your new API key has been generated and sent to your DM.');

        try {
          const dmEmbed = new EmbedBuilder()
            .setColor(config.embedColor)
            .setTitle('🔑 Your New API Key')
            .setDescription(`\`\`\`${newApiKey}\`\`\``)
            .addFields(
              { name: 'Generated At', value: new Date().toLocaleString(), inline: true },
              { name: 'Usage', value: 'Use this key to access the API', inline: true }
            )
            .setTimestamp();

          await interaction.user.send({ embeds: [dmEmbed] });
          await interaction.reply({ embeds: [embed] });
        } catch (error) {
          embed.setDescription('API key generated but failed to send DM. Please check your DM settings.');
          await interaction.reply({ embeds: [embed], ephemeral: true });
        }
        break;

      case 'list':
        if (!isOwner(userId)) {
          embed.setTitle('❌ Access Denied')
            .setDescription('Only the bot owner can use this command.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const allKeys = [];
        for (const [uId, userData] of Object.entries(apiKeys)) {
          userData.keys.forEach(keyData => {
            allKeys.push({
              userId: uId,
              username: keyData.username,
              key: keyData.key,
              createdAt: keyData.createdAt
            });
          });
        }

        if (allKeys.length === 0) {
          embed.setTitle('📋 API Keys List')
            .setDescription('No API keys found.');
        } else {
          const keysList = allKeys.map((keyData, index) => 
            `**${index + 1}.** <@${keyData.userId}> (${keyData.username})\n\`${keyData.key}\`\nCreated: ${new Date(keyData.createdAt).toLocaleString()}\n`
          ).join('\n');

          embed.setTitle('📋 API Keys List')
            .setDescription(keysList.length > 4096 ? 'Too many keys to display. Check console for full list.' : keysList);
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'remove':
        if (!isOwner(userId)) {
          embed.setTitle('❌ Access Denied')
            .setDescription('Only the bot owner can use this command.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const keyToRemove = options.getString('apikey');
        let removed = false;

        for (const [uId, userData] of Object.entries(apiKeys)) {
          const keyIndex = userData.keys.findIndex(k => k.key === keyToRemove);
          if (keyIndex !== -1) {
            userData.keys.splice(keyIndex, 1);
            userData.count--;
            removed = true;
            break;
          }
        }

        if (removed) {
          saveApiKeys();
          embed.setTitle('✅ API Key Removed')
            .setDescription(`API key \`${keyToRemove}\` has been removed successfully.`);
        } else {
          embed.setTitle('❌ API Key Not Found')
            .setDescription(`API key \`${keyToRemove}\` was not found.`);
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'status':
        const keyToCheck = options.getString('apikey');
        let found = false;
        let keyInfo = null;

        for (const [uId, userData] of Object.entries(apiKeys)) {
          const keyData = userData.keys.find(k => k.key === keyToCheck);
          if (keyData) {
            found = true;
            keyInfo = {
              userId: uId,
              username: keyData.username,
              createdAt: keyData.createdAt
            };
            break;
          }
        }

        if (found) {
          embed.setTitle('🔍 API Key Status')
            .setDescription('**Status:** Valid ✅')
            .addFields(
              { name: 'Owner', value: `<@${keyInfo.userId}> (${keyInfo.username})`, inline: true },
              { name: 'Created', value: new Date(keyInfo.createdAt).toLocaleString(), inline: true }
            );
        } else {
          embed.setTitle('🔍 API Key Status')
            .setDescription('**Status:** Invalid ❌')
            .addFields(
              { name: 'Error', value: 'API key not found or expired', inline: false }
            );
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'add':
        if (!isOwner(userId)) {
          embed.setTitle('❌ Access Denied')
            .setDescription('Only the bot owner can use this command.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const targetUser = options.getUser('user');
        const reason = options.getString('reason') || 'No reason provided';
        const targetUserId = targetUser.id;
        const targetUsername = targetUser.username;

        if (!apiKeys[targetUserId]) {
          apiKeys[targetUserId] = { keys: [], count: 0 };
        }

        if (apiKeys[targetUserId].count >= 3) {
          embed.setTitle('❌ Cannot Add API Key')
            .setDescription(`User ${targetUser.tag} has reached the maximum limit of 3 API keys.`);
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const adminApiKey = generateApiKey(targetUsername);
        apiKeys[targetUserId].keys.push({
          key: adminApiKey,
          createdAt: new Date().toISOString(),
          username: targetUsername,
          addedBy: userId,
          reason: reason
        });
        apiKeys[targetUserId].count++;
        saveApiKeys();

        embed.setTitle('✅ API Key Added')
          .setDescription(`API key added for ${targetUser.tag}`)
          .addFields(
            { name: 'Reason', value: reason, inline: false },
            { name: 'API Key', value: `\`${adminApiKey}\``, inline: false }
          );

        try {
          const userDmEmbed = new EmbedBuilder()
            .setColor(config.embedColor)
            .setTitle('🔑 API Key Added')
            .setDescription(`An API key has been added to your account by an administrator.`)
            .addFields(
              { name: 'API Key', value: `\`${adminApiKey}\``, inline: false },
              { name: 'Reason', value: reason, inline: false },
              { name: 'Generated At', value: new Date().toLocaleString(), inline: true }
            )
            .setTimestamp();

          await targetUser.send({ embeds: [userDmEmbed] });
        } catch (error) {
          embed.addFields({ name: 'Note', value: 'Could not send DM to user', inline: false });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'auto-remove':
        if (!isOwner(userId)) {
          embed.setTitle('❌ Access Denied')
            .setDescription('Only the bot owner can use this command.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const enabled = options.getBoolean('enabled');
        
        // Update config.json with auto-remove setting
        const configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
        configData.autoRemoveApiKeys = enabled;
        
        try {
          fs.writeFileSync('./config.json', JSON.stringify(configData, null, 2));
        } catch (error) {
          console.error('Error saving config:', error);
          embed.setTitle('❌ Error')
            .setDescription('Failed to save auto-remove setting.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        embed.setTitle('⚙️ Auto-Remove Settings Updated')
          .setDescription(`Auto-removal of API keys when users leave server: **${enabled ? 'Enabled' : 'Disabled'}**`)
          .addFields({
            name: 'Info',
            value: enabled ? 'API keys will be automatically removed when users leave the server.' : 'API keys will not be automatically removed.',
            inline: false
          });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;

      case 'show':
        // Check if command is used in allowed channel
        if (config.allowedChannel && interaction.channelId !== config.allowedChannel) {
          embed.setTitle('❌ Command Not Allowed Here')
            .setDescription('This command can only be used in the designated channel.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        if (!apiKeys[userId] || apiKeys[userId].keys.length === 0) {
          embed.setTitle('🔑 Your API Keys')
            .setDescription('You don\'t have any API keys yet. Use `/apikey generate` to create one.');
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const userKeys = apiKeys[userId].keys.map((keyData, index) => 
          `**${index + 1}.** \`${keyData.key}\`\nCreated: ${new Date(keyData.createdAt).toLocaleString()}`
        ).join('\n\n');

        embed.setTitle('🔑 Your API Keys')
          .setDescription(userKeys)
          .addFields({
            name: 'Total Keys',
            value: `${apiKeys[userId].keys.length}/3`,
            inline: true
          });

        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
    }
  }
});

// Handle when a user leaves the server
client.on('guildMemberRemove', async (member) => {
  try {
    // Read current config to check if auto-remove is enabled
    const configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
    
    if (!configData.autoRemoveApiKeys) {
      return; // Auto-remove is disabled
    }

    const userId = member.user.id;
    
    // Check if user has API keys
    if (apiKeys[userId] && apiKeys[userId].keys.length > 0) {
      const removedKeysCount = apiKeys[userId].keys.length;
      const username = member.user.username;
      
      // Remove all API keys for this user
      delete apiKeys[userId];
      saveApiKeys();
      
      console.log(`Auto-removed ${removedKeysCount} API key(s) for user ${username} (${userId}) who left the server.`);
      
      // Log to owner if possible
      try {
        const owner = await client.users.fetch(config.owner);
        const logEmbed = new EmbedBuilder()
          .setColor(config.embedColor)
          .setTitle('🔄 Auto-Remove API Keys')
          .setDescription(`Automatically removed **${removedKeysCount}** API key(s) for user who left the server.`)
          .addFields(
            { name: 'User', value: `${username} (${userId})`, inline: true },
            { name: 'Keys Removed', value: removedKeysCount.toString(), inline: true }
          )
          .setTimestamp();
        
        await owner.send({ embeds: [logEmbed] });
      } catch (error) {
        console.log('Could not send auto-remove notification to owner:', error.message);
      }
    }
  } catch (error) {
    console.error('Error in guildMemberRemove event:', error);
  }
});

// Start both Express server and Discord bot
app.listen(port, '0.0.0.0', () => {
  console.log('API Server running on port 5000');
});

client.login(config.token);