const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ActivityType
} = require('discord.js');
const express = require('express');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'secure_secret_token';

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('FATAL ERROR: DISCORD_TOKEN and CLIENT_ID must be set in the environment.');
  process.exit(1);
}

// Local database file to persist settings per guild (essential for Railway restarts)
const DB_FILE = path.join(__dirname, 'guild_configs.json');
let guildConfigs = new Map();

// Helper function to load configs
function loadConfigs() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(data);
      guildConfigs = new Map(Object.entries(parsed));
      console.log('Successfully loaded guild configurations.');
    } else {
      guildConfigs = new Map();
      saveConfigs();
    }
  } catch (error) {
    console.error('Error loading config database:', error);
    guildConfigs = new Map();
  }
}

// Helper function to save configs
function saveConfigs() {
  try {
    const obj = Object.fromEntries(guildConfigs);
    fs.writeFileSync(DB_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving config database:', error);
  }
}

// Load DB immediately
loadConfigs();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

const commands = [
  new SlashCommandBuilder()
    .setName('setup-store')
    .setDescription('Creates and configures a new store channel for this guild.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),
  
  new SlashCommandBuilder()
    .setName('store-settings')
    .setDescription('Configure your store website URL and Affiliate/Partner ID.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption(option => 
      option.setName('website')
        .setDescription('Enter your website URL (e.g., https://my-store.com)')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('affiliate_id')
        .setDescription('Your Affiliate/Partner ID for product links')
        .setRequired(true)),

  new SlashCommandBuilder()
    .setName('post-product')
    .setDescription('Manually post a product using your guild settings (Admin only).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption(option => 
      option.setName('title')
        .setDescription('Product Title')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('description')
        .setDescription('Product Description')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('price')
        .setDescription('Product Price (e.g. $19.99)')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('url_path')
        .setDescription('The product link path (e.g. /products/shoes or full URL)')
        .setRequired(true))
    .addStringOption(option => 
      option.setName('image')
        .setDescription('Product Image URL')
        .setRequired(false))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    console.log('Started refreshing application (/) commands.');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands },
    );
    console.log('Successfully reloaded application (/) commands.');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await registerCommands();
  client.user.setActivity('user marketplaces', { type: ActivityType.Watching });
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const guildId = interaction.guild.id;

      // 1. Setup Store Command
      if (interaction.commandName === 'setup-store') {
        const modal = new ModalBuilder()
          .setCustomId('setupStoreModal')
          .setTitle('Configure Store Channel');

        const channelNameInput = new TextInputBuilder()
          .setCustomId('channelNameInput')
          .setLabel("What should we name the store channel?")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., premium-shop')
          .setRequired(true)
          .setMinLength(2)
          .setMaxLength(100);

        const firstActionRow = new ActionRowBuilder().addComponents(channelNameInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
      }
      
      // 2. Configure Store Settings Command
      if (interaction.commandName === 'store-settings') {
        const website = interaction.options.getString('website');
        const affiliateId = interaction.options.getString('affiliate_id');

        // Simple URL validation
        try {
          new URL(website);
        } catch (_) {
          return interaction.reply({ content: '❌ Please provide a valid website URL starting with http:// or https://', ephemeral: true });
        }

        // Fetch existing config or create new one
        const currentConfig = guildConfigs.get(guildId) || {};
        currentConfig.website = website;
        currentConfig.affiliateId = affiliateId;

        guildConfigs.set(guildId, currentConfig);
        saveConfigs();

        await interaction.reply({
          content: `✅ **Settings Updated!**\n🌐 **Website:** ${website}\n🆔 **Affiliate ID:** \`${affiliateId}\`\n\n*Make sure you run \`/setup-store\` to allow products to be posted!*`,
          ephemeral: true
        });
      }

      // 3. Post Product Command (Manual)
      if (interaction.commandName === 'post-product') {
        const config = guildConfigs.get(guildId);
        if (!config || !config.channelId) {
          return interaction.reply({ content: '❌ Store channel not configured yet. Please use `/setup-store` first.', ephemeral: true });
        }

        if (!config.website) {
          return interaction.reply({ content: '❌ Store website not configured. Please run `/store-settings` first.', ephemeral: true });
        }

        const channel = interaction.guild.channels.cache.get(config.channelId);
        if (!channel) {
          return interaction.reply({ content: '❌ Configured store channel was not found. Please run `/setup-store` again.', ephemeral: true });
        }

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const price = interaction.options.getString('price');
        const urlPath = interaction.options.getString('url_path');
        const image = interaction.options.getString('image');

        // Generate absolute URL with the configured affiliate ID
        const absoluteUrl = buildAffiliateUrl(config.website, urlPath, config.affiliateId);

        await postProductToChannel(channel, { title, description, price, url: absoluteUrl, image });
        await interaction.reply({ content: `✅ Product posted successfully in <#${channel.id}>!`, ephemeral: true });
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'setupStoreModal') {
        await interaction.deferReply({ ephemeral: true });
        const channelName = interaction.fields.getTextInputValue('channelNameInput');
        const guildId = interaction.guild.id;

        try {
          const formattedName = channelName.toLowerCase().replace(/\s+/g, '-');

          // Create text channel with restricted write/reaction permissions for @everyone
          const channel = await interaction.guild.channels.create({
            name: formattedName,
            type: ChannelType.GuildText,
            permissionOverwrites: [
              {
                id: interaction.guild.roles.everyone.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions],
              },
              {
                id: client.user.id,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.EmbedLinks,
                  PermissionFlagsBits.AddReactions,
                  PermissionFlagsBits.ReadMessageHistory
                ],
              }
            ],
          });

          // Fetch current config or build new one
          const currentConfig = guildConfigs.get(guildId) || {};
          currentConfig.channelId = channel.id;

          guildConfigs.set(guildId, currentConfig);
          saveConfigs();

          await interaction.editReply({ content: `🎉 Store channel <#${channel.id}> has been created and configured successfully!` });
          await channel.send({ content: '🛍️ **Welcome to our Official Store!** New products will automatically appear here. Stay tuned!' });
        } catch (error) {
          console.error('Error creating store channel:', error);
          await interaction.editReply({ content: '❌ Failed to create the channel. Ensure the bot has "Manage Channels" permission.' });
        }
      }
    }
  } catch (error) {
    console.error('Global Interaction Error:', error);
    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true });
      } catch (e) { /* silent catch */ }
    }
  }
});

function buildAffiliateUrl(baseWebsite, pathOrUrl, affiliateId) {
  try {
    let finalUrl;
    // Check if pathOrUrl is already an absolute URL
    if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
      finalUrl = new URL(pathOrUrl);
    } else {
      // Ensure path is correctly formatted
      const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
      finalUrl = new URL(cleanPath, baseWebsite);
    }

    // Append affiliate ID parameter
    if (affiliateId) {
      finalUrl.searchParams.set('ref', affiliateId);
    }
    return finalUrl.toString();
  } catch (e) {
    return pathOrUrl;
  }
}

async function postProductToChannel(channel, productData) {
  try {
    const { title, description, price, url, image } = productData;

    const embed = new EmbedBuilder()
      .setColor('#2ecc71')
      .setTitle(`🛒 ${title}`)
      .setURL(url)
      .setDescription(description)
      .addFields(
        { name: '💵 Price', value: `**${price}**`, inline: true },
        { name: '⚡ Status', value: '🟢 In Stock', inline: true }
      )
      .setFooter({ text: 'Verified Store Product', iconURL: channel.guild.iconURL() })
      .setTimestamp();

    if (image && image.startsWith('http')) {
      embed.setImage(image);
    }

    const buyButton = new ButtonBuilder()
      .setLabel('Buy Now 🛒')
      .setURL(url)
      .setStyle(ButtonStyle.Link);

    const actionRow = new ActionRowBuilder().addComponents(buyButton);

    const message = await channel.send({ 
      embeds: [embed], 
      components: [actionRow] 
    });

    // Auto-reactions (Safe even if members cannot add new reactions)
    await message.react('🔥');
    await message.react('💖');
    
    return message;
  } catch (error) {
    console.error(`Failed to post product to channel ${channel.id}:`, error);
    throw error;
  }
}

const app = express();
app.use(express.json());

// Webhook listens for product payloads from ANY configured user website
app.post('/api/webhook/new-product', async (req, res) => {
  const authHeader = req.headers['authorization'];
  
  // Security Authentication
  if (authHeader !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid security credentials.' });
  }

  const { guildId, title, description, price, url_path, image } = req.body;

  if (!guildId || !title || !price || !url_path) {
    return res.status(400).json({ error: 'Missing parameters: guildId, title, price, and url_path are required.' });
  }

  // Find dynamic guild configurations
  const config = guildConfigs.get(guildId);
  if (!config || !config.channelId) {
    return res.status(404).json({ error: `Store channel is not configured for Guild ID: ${guildId}. Ask the Admin to run /setup-store.` });
  }

  if (!config.website) {
    return res.status(400).json({ error: `Guild ID: ${guildId} has not configured their store website yet. Admin must run /store-settings.` });
  }

  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Guild not loaded in bot cache.');

    const channel = guild.channels.cache.get(config.channelId);
    if (!channel) throw new Error('Configured channel not found in server.');

    // Build unique absolute URL with the configured guild's base website and affiliate ID
    const absoluteUrl = buildAffiliateUrl(config.website, url_path, config.affiliateId);

    await postProductToChannel(channel, {
      title,
      description: description || 'No description provided.',
      price,
      url: absoluteUrl,
      image
    });

    res.status(200).json({ success: true, message: 'Product posted successfully to Discord using dynamic guild settings.' });
  } catch (error) {
    console.error('Webhook processing failure:', error);
    res.status(500).json({ error: `Internal error: ${error.message}` });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('Dynamic Webhook API & Discord bot are running.');
});

app.listen(PORT, () => {
  console.log(`Webhook handler server successfully started on port ${PORT}`);
});

client.login(DISCORD_TOKEN);
